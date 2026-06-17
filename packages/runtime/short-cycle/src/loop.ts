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
 *   Engineer draft → mechanical gate → (on pass) fresh Verifier (memory: none,
 *   IDENTICAL payload every iter) → focal-verdict check.
 * The "mechanical gate" is the injected `gate` dep — for the headless engineer
 * that is the POST-HOC in-process `gateWorktreeEdits` over the worktree diff (NOT
 * the interactive Claude Code PreToolUse hook, which the headless engineer does
 * not pass through); tests inject a scripted gate.
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
  /**
   * Gate the Engineer draft. In prod this is the post-hoc in-process
   * `gateWorktreeEdits` over the worktree diff (the headless engineer's REAL
   * boundary — it does not pass through the interactive PreToolUse hook); tests
   * inject a scripted gate. When absent the cycle is UNGATED (structural/test
   * runs only — the live CLI always injects it).
   */
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

/** 1–2 sentence summary of what the Engineer changed this iteration (v9 App. A.6; P5-T1). */
function engineerChangeSummary(output: string | undefined): string {
  const firstLine = (output ?? "").split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
  if (firstLine.length === 0) return "(no engineer output)";
  return firstLine.length > 240 ? `${firstLine.slice(0, 237)}...` : firstLine;
}

type VerdictDelta = { flipped_triples: string[]; new_failures: string[]; new_passes: string[] };

/**
 * What changed vs the prior iteration's verdict (v9 App. A.6): triples that
 * flipped pass↔fail, plus triples failing / passing for the FIRST time.
 */
function verdictDelta(
  current: Map<string, "pass" | "fail">,
  prior: Map<string, "pass" | "fail"> | null,
  everFailed: Set<string>,
  everPassed: Set<string>,
): VerdictDelta {
  const flipped: string[] = [];
  const newFailures: string[] = [];
  const newPasses: string[] = [];
  for (const [id, status] of current) {
    const before = prior?.get(id);
    if (before !== undefined && before !== status) flipped.push(id);
    if (status === "fail" && !everFailed.has(id)) newFailures.push(id);
    if (status === "pass" && !everPassed.has(id)) newPasses.push(id);
  }
  return { flipped_triples: flipped, new_failures: newFailures, new_passes: newPasses };
}

export async function runShortCycle(deps: ShortCycleDeps): Promise<RuntimeResult<ShortCycleOutcome>> {
  let perEntryIter = 0;
  let lifetimeIter = deps.lifetimeStart ?? 0;
  let feedback: string | null = null;
  let diagnosisWrites = 0;
  let diagnosisWrittenThisEntry = false;
  const failingSets: string[][] = [];
  const diagnosisHistory: string[] = [];
  // v9 stuck-bead debugging state (P5-T1): per-triple status history for verdict deltas.
  const everFailed = new Set<string>();
  const everPassed = new Set<string>();
  let priorStatus: Map<string, "pass" | "fail"> | null = null;
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
      feedback = gate.rejection ?? "the mechanical gate rejected the draft";
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

    // v9 stuck-bead debugging (P5-T1): delta vs the prior iteration's verdict.
    const tripleStatus = new Map<string, "pass" | "fail">(verdict.per_triple.map((t) => [t.triple_id, t.focal_verdict]));
    const delta = verdictDelta(tripleStatus, priorStatus, everFailed, everPassed);
    for (const [id, status] of tripleStatus) (status === "fail" ? everFailed : everPassed).add(id);
    priorStatus = tripleStatus;

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

    // 6. Bead-Orchestrator tick trace (carries stuckness_detector_state + the v9
    // stuck-bead debugging fields; diagnosis flag auto-computed from its memory).
    // The tick is a model-call spawn (the taskRunner ELSE branch); a surfaced
    // model-call failure here MUST be propagated, not silently dropped — else the
    // spawn seam's returned failure (RFC App. D.33) would let the loop continue as
    // if the tick succeeded (a silent false-success).
    const orchestratorTick = await deps.spawn({
      role: "bead-orchestrator",
      beadId: deps.beadId,
      sessionId: deps.sessionId,
      input: "route",
      iterationNumber: perEntryIter,
      invocationSite: "short-cycle",
      beadLifecycle: {
        stuckness_detector_state: { fired },
        failing_triple_set: failing,
        verdict_delta_from_prior: delta,
        engineer_change_summary: engineerChangeSummary(engineer.value.output),
      },
    });
    if (!orchestratorTick.success) return orchestratorTick;

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
