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
  | { kind: "budget_exhaustion" }
  | { kind: "continue" };

export function resolveTickPrecedence(input: {
  livelockReport: TestVerifierLivelockReport | null;
  budgetExhausted: boolean;
}): TickOutcome {
  if (input.livelockReport) return { kind: "livelock", report: input.livelockReport };
  if (input.budgetExhausted) return { kind: "budget_exhaustion" };
  return { kind: "continue" };
}
