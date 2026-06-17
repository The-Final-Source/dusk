import { isDuskError, ok, type BoundSpawn, type NoVerdictReason, type RuntimeResult, type Verdict } from "@dusk/core-schema";

import type { Tuple } from "./universe.js";

/**
 * Step-5 long cycle (RFC §6.5; design D5; 8.2/8.3). Samples up to N=10 random
 * unique tuples from the affected universe; each is evaluated by a fresh Verifier.
 * On the FIRST reject in a round set it fires an N=2 confirmation pass (three
 * calls share `confirmation_of_trace_id`): ≥1/2 confirm → `confirmed_reject`
 * (re-enter Step 4 with the regressed intent); both override → dismissed flaky
 * (continue). Subsequent rejects do NOT fire another confirmation pass.
 */

export const DEFAULT_ROUND_COUNT = 10;

export type LongCycleDeps = {
  spawn: BoundSpawn;
  beadId: string;
  sessionId: string;
  universe: Tuple[];
  roundCount?: number;
  /** Deterministic shuffle override (tests inject identity); default is identity. */
  shuffle?: (tuples: Tuple[]) => Tuple[];
  verifierInputFor: (tuple: Tuple) => string;
};

export type LongCycleOutcome =
  | { kind: "clean"; sampledVerdicts: number }
  | { kind: "confirmed_reject"; regressedIntent: string; confirmationTraceId: string; sampledVerdicts: number }
  // App. D.34 (gap #6 / R6/R7/D8): a long-cycle Verifier leg returned no usable
  // verdict (empty/degraded). It is INFRASTRUCTURE — NEVER counted as a confirming
  // reject, NEVER as a flaky-dismiss ("no_verdict ≠ accept"), NEVER the former
  // terminal recoverable:false downgrade. Routes the bead to the no_verdict axis.
  | { kind: "no_verdict"; reason: NoVerdictReason; sampledVerdicts: number };

type VerifierLeg = { verdict: Verdict; traceId: string } | { noVerdict: NoVerdictReason };

async function verifierVerdict(spawn: BoundSpawn, params: Parameters<BoundSpawn>[0]): Promise<RuntimeResult<VerifierLeg>> {
  const r = await spawn(params);
  if (!r.success) return r;
  const verdict = r.value.verdict;
  if (!verdict || isDuskError(verdict)) {
    const reason: NoVerdictReason =
      verdict && isDuskError(verdict) && typeof verdict.details?.no_verdict_reason === "string"
        ? (verdict.details.no_verdict_reason as NoVerdictReason)
        : "empty";
    return ok({ noVerdict: reason });
  }
  return ok({ verdict, traceId: r.value.trace.trace_id });
}

export async function runLongCycle(deps: LongCycleDeps): Promise<RuntimeResult<LongCycleOutcome>> {
  const roundCount = deps.roundCount ?? DEFAULT_ROUND_COUNT;
  const shuffle = deps.shuffle ?? ((t: Tuple[]) => t);
  const sampled = shuffle([...deps.universe]).slice(0, roundCount); // early stop when universe < roundCount

  let confirmationFired = false;
  let sampledVerdicts = 0;
  let subsequentRejectIntent: string | null = null;

  for (const tuple of sampled) {
    const original = await verifierVerdict(deps.spawn, {
      role: "verifier",
      beadId: deps.beadId,
      sessionId: deps.sessionId,
      input: deps.verifierInputFor(tuple),
      invocationSite: "long-cycle",
      intentPath: tuple.intent_path,
    });
    if (!original.success) return original;
    // A no_verdict on the sampled leg is infrastructure — never a clean pass.
    if ("noVerdict" in original.value) return ok({ kind: "no_verdict", reason: original.value.noVerdict, sampledVerdicts });
    sampledVerdicts += 1;

    if (original.value.verdict.decision !== "reject") continue;

    if (confirmationFired) {
      // Subsequent reject in the same round set: NO confirmation pass; recorded
      // directly for the round set's aggregation.
      subsequentRejectIntent = tuple.intent_path;
      continue;
    }

    // First reject → N=2 confirmation pass on the SAME tuple, correlated by the
    // original spawn's trace id (all three share `confirmation_of_trace_id`).
    confirmationFired = true;
    const confirmationTraceId = original.value.traceId;
    const confirmations: Verdict[] = [];
    for (let i = 0; i < 2; i++) {
      const conf = await verifierVerdict(deps.spawn, {
        role: "verifier",
        beadId: deps.beadId,
        sessionId: deps.sessionId,
        input: deps.verifierInputFor(tuple),
        invocationSite: "long-cycle",
        intentPath: tuple.intent_path,
        beadLifecycle: { confirmation_of_trace_id: confirmationTraceId },
        // The completing confirmation spawn's trace records the aggregated
        // outcome (P5-T1): ≥1/2 rejects confirm; both accepts dismiss as flaky.
        ...(i === 1
          ? {
              confirmationOutcomeFromVerdict: (decision: "accept" | "reject") =>
                confirmations[0].decision === "reject" || decision === "reject" ? "confirmed_reject" : "flaky_verdict_dismissed",
            }
          : {}),
      });
      if (!conf.success) return conf;
      // App. D.34 / D8: a no_verdict confirmation is NEITHER a confirming reject
      // NOR a flaky-dismiss — we cannot confirm or dismiss on degraded infra, so
      // route the bead to the no_verdict axis. (Forbidden: original reject + two
      // no_verdict confirmations silently dismissed as flaky.)
      if ("noVerdict" in conf.value) return ok({ kind: "no_verdict", reason: conf.value.noVerdict, sampledVerdicts });
      confirmations.push(conf.value.verdict);
    }

    const confirmingRejects = confirmations.filter((v) => v.decision === "reject").length;
    if (confirmingRejects >= 1) {
      return ok({ kind: "confirmed_reject", regressedIntent: tuple.intent_path, confirmationTraceId, sampledVerdicts });
    }
    // Both overrode to accept → flaky_verdict_dismissed; continue sampling.
  }

  if (subsequentRejectIntent) {
    return ok({ kind: "confirmed_reject", regressedIntent: subsequentRejectIntent, confirmationTraceId: "", sampledVerdicts });
  }
  return ok({ kind: "clean", sampledVerdicts });
}
