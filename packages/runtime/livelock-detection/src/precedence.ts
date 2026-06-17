import type { TestVerifierLivelockReport } from "@dusk/core-schema";

/**
 * Livelock-vs-budget precedence (RFC §6.4.1, §3.4.1; design D7; 10.3 / P3-T28).
 * The orchestrator's tick evaluates the livelock detector BEFORE the
 * budget-exhaustion check. When both fire on the same iteration, the livelock
 * report wins (it carries a strictly richer payload) — no recovery-ladder
 * exhaustion error is emitted, and the user resolves via `dusk_resolve_livelock`.
 */

export type TickOutcome =
  | { kind: "livelock"; report: TestVerifierLivelockReport }
  | { kind: "no_verdict" }
  | { kind: "budget_exhaustion" }
  | { kind: "continue" };

/**
 * Precedence `livelock > no_verdict > budget` (RFC App. D.34, design D7). The
 * `no_verdict` arm fires when the finite infrastructure-recovery counter is
 * exhausted (the counter itself lives in the orchestrator's per-bead closure —
 * this module stays a pure detector). It sits BETWEEN livelock and budget: a
 * genuine livelock still wins (its payload is strictly richer), but infrastructure
 * exhaustion preempts a plain budget-exhaustion error. `no_verdict` iterations are
 * excluded from the livelock reject-observations at their push site, so infra
 * noise never trips the consecutive-reject detector here.
 */
export function resolveTickPrecedence(input: {
  livelockReport: TestVerifierLivelockReport | null;
  noVerdictExhausted?: boolean;
  budgetExhausted: boolean;
}): TickOutcome {
  if (input.livelockReport) return { kind: "livelock", report: input.livelockReport };
  if (input.noVerdictExhausted) return { kind: "no_verdict" };
  if (input.budgetExhausted) return { kind: "budget_exhaustion" };
  return { kind: "continue" };
}
