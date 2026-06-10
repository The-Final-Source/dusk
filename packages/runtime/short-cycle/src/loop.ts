import { existsSync, readFileSync } from "node:fs";

import {
  duskError,
  err,
  isDuskError,
  ok,
  type BoundSpawn,
  type RuntimeResult,
  type SpawnOutcome,
  type Verdict,
} from "@dusk/core-schema";
import { emptyBeadMemory, memoryFilePath, parseBeadMemory, serializeBeadMemory, writeBackMemory } from "@dusk/runtime-memory";

import { stucknessFiredAt } from "./stuckness.js";

/**
 * Step-4 short cycle (RFC §6.4; 6.1/6.2/6.5/6.6/6.7/6.8). Per iteration:
 *   Engineer draft → PreToolUse gate → (on pass) fresh Verifier (memory: none,
 *   IDENTICAL payload every iter) → focal-verdict check.
 * Diagnosis writes are forced when the stuckness detector fires (≥ iter 3) or, as
 * a fallback, at iter 5. Iter-15 surfaces an early escalation whose payload is the
 * bead-memory diagnosis. `support_quality: low_confidence` is advisory — it never
 * triggers re-draft (only `focal_verdict: fail` does). The Verifier's input is a
 * compile-time constant of the loop, so its `raw_prompt` is identical across
 * iterations (the no-leak invariant).
 */

export const ITER_FALLBACK_DIAGNOSIS = 5;
export const ITER_EARLY_ESCALATION = 15;

export type LowConfidenceSupport = { intent_path: string; triple_id: string; rationale: string };

export type GateResult = { blocked: boolean; rejection?: string };

export type ShortCycleDeps = {
  spawn: BoundSpawn;
  beadId: string;
  sessionId: string;
  rootDir: string;
  intentPath: string;
  perEntryMax: number;
  lifetimeMax: number;
  /** Lifetime iterations already consumed in prior Step-4 entries (carried across). */
  lifetimeStart?: number;
  /** Build the Engineer draft input from the latest feedback (re-draft signal). */
  engineerInput: (feedback: string | null) => string;
  /** CONSTANT Verifier input — identical across iterations (no-leak invariant). */
  verifierInput: string;
  /** Gate the Engineer draft (real PreToolUse hook in prod; scripted in tests). */
  gate?: (engineer: SpawnOutcome) => GateResult;
  /** Override the diagnosis writer (default writes bead memory for engineer + bead-orchestrator). */
  writeDiagnosis?: (text: string) => void;
  diagnosisText?: (failingSet: string[]) => string;
};

export type ShortCycleOutcome =
  | { kind: "converged"; verdict: Verdict; perEntryIters: number; lifetimeIters: number; lowConfidenceSupports: LowConfidenceSupport[]; diagnosisWrites: number }
  | { kind: "per_entry_exhausted"; perEntryIters: number; lifetimeIters: number; diagnosisWrites: number }
  | { kind: "escalated_iter15"; diagnosis: string; perEntryIters: number; lifetimeIters: number }
  | { kind: "budget_exhausted"; perEntryIters: number; lifetimeIters: number; diagnosisHistory: string[] };

function defaultWriteDiagnosis(rootDir: string, beadId: string, text: string): void {
  for (const role of ["engineer", "bead-orchestrator"]) {
    const path = memoryFilePath(rootDir, "bead", role, { beadId });
    const memory = path && existsSync(path) ? parseBeadMemory(readFileSync(path, "utf8")) : emptyBeadMemory(beadId, role);
    memory.current_diagnosis = text;
    writeBackMemory({ rootDir, scope: "bead", role, content: serializeBeadMemory(memory), ids: { beadId } });
  }
}

export function readDiagnosis(rootDir: string, beadId: string): string {
  const path = memoryFilePath(rootDir, "bead", "bead-orchestrator", { beadId });
  if (!path || !existsSync(path)) return "";
  return parseBeadMemory(readFileSync(path, "utf8")).current_diagnosis;
}

export async function runShortCycle(deps: ShortCycleDeps): Promise<RuntimeResult<ShortCycleOutcome>> {
  let perEntryIter = 0;
  let lifetimeIter = deps.lifetimeStart ?? 0;
  let feedback: string | null = null;
  let diagnosisWrites = 0;
  let diagnosisWrittenThisEntry = false;
  const failingSets: string[][] = [];
  const diagnosisHistory: string[] = [];
  const writeDiag = (text: string): void =>
    deps.writeDiagnosis ? deps.writeDiagnosis(text) : defaultWriteDiagnosis(deps.rootDir, deps.beadId, text);

  for (;;) {
    perEntryIter += 1;
    lifetimeIter += 1;

    // 1. Engineer draft.
    const engineer = await deps.spawn({
      role: "engineer",
      beadId: deps.beadId,
      sessionId: deps.sessionId,
      input: deps.engineerInput(feedback),
      iterationNumber: perEntryIter,
      invocationSite: "short-cycle",
      intentPath: deps.intentPath,
    });
    if (!engineer.success) return engineer;

    // 2. Gate. A blocked draft re-drafts WITHOUT spawning the Verifier (6.2).
    const gate = deps.gate ? deps.gate(engineer.value) : { blocked: false };
    if (gate.blocked) {
      feedback = gate.rejection ?? "the PreToolUse gate rejected the draft";
      if (lifetimeIter >= deps.lifetimeMax) return ok({ kind: "budget_exhausted", perEntryIters: perEntryIter, lifetimeIters: lifetimeIter, diagnosisHistory });
      if (perEntryIter >= deps.perEntryMax) return ok({ kind: "per_entry_exhausted", perEntryIters: perEntryIter, lifetimeIters: lifetimeIter, diagnosisWrites });
      continue;
    }

    // 3. Fresh Verifier (memory: none, CONSTANT input).
    const verifierSpawn = await deps.spawn({
      role: "verifier",
      beadId: deps.beadId,
      sessionId: deps.sessionId,
      input: deps.verifierInput,
      iterationNumber: perEntryIter,
      invocationSite: "short-cycle",
      intentPath: deps.intentPath,
    });
    if (!verifierSpawn.success) return verifierSpawn;
    const verdict = verifierSpawn.value.verdict;
    if (!verdict || isDuskError(verdict)) {
      return err(duskError("verifier_model_call_failed", "the Verifier returned no verdict in the short cycle", { recoverable: false, bead_id: deps.beadId, step: 4 }));
    }

    // 4. Failing-triple set + low-confidence supports.
    const failing = verdict.per_triple.filter((t) => t.focal_verdict === "fail").map((t) => t.triple_id);
    failingSets.push(failing);
    const converged = failing.length === 0; // 6.7: support_quality is NOT consulted here

    // 5. Stuckness / diagnosis (only while not converged).
    let fired = false;
    if (!converged) {
      fired = stucknessFiredAt(failingSets);
      if ((fired || perEntryIter === ITER_FALLBACK_DIAGNOSIS) && !diagnosisWrittenThisEntry) {
        const text = deps.diagnosisText ? deps.diagnosisText(failing) : `Converging on failing triples: ${failing.join(", ")}. Reconsider the approach.`;
        writeDiag(text);
        diagnosisWrites += 1;
        diagnosisWrittenThisEntry = true;
        diagnosisHistory.push(text);
      }
    }

    // 6. Bead-Orchestrator tick trace (carries stuckness_detector_state; diagnosis flag auto-computed from its memory).
    await deps.spawn({
      role: "bead-orchestrator",
      beadId: deps.beadId,
      sessionId: deps.sessionId,
      input: "route",
      iterationNumber: perEntryIter,
      invocationSite: "short-cycle",
      beadLifecycle: { stuckness_detector_state: { fired } },
    });

    // 7. Converged → exit to Step 5.
    if (converged) {
      const lowConfidenceSupports = verdict.per_triple
        .filter((t) => t.support_quality === "low_confidence")
        .map((t) => ({ intent_path: deps.intentPath, triple_id: t.triple_id, rationale: t.rationale }));
      return ok({ kind: "converged", verdict, perEntryIters: perEntryIter, lifetimeIters: lifetimeIter, lowConfidenceSupports, diagnosisWrites });
    }

    // 8. Iter-15 early escalation (within a single entry).
    if (perEntryIter === ITER_EARLY_ESCALATION) {
      return ok({ kind: "escalated_iter15", diagnosis: readDiagnosis(deps.rootDir, deps.beadId), perEntryIters: perEntryIter, lifetimeIters: lifetimeIter });
    }

    // 9. Budget checks (lifetime is the hard cap; checked before per-entry).
    if (lifetimeIter >= deps.lifetimeMax) return ok({ kind: "budget_exhausted", perEntryIters: perEntryIter, lifetimeIters: lifetimeIter, diagnosisHistory });
    if (perEntryIter >= deps.perEntryMax) return ok({ kind: "per_entry_exhausted", perEntryIters: perEntryIter, lifetimeIters: lifetimeIter, diagnosisWrites });

    // 10. Re-draft on focal failure.
    feedback = `focal_verdict: fail on ${failing.join(", ")}`;
  }
}
