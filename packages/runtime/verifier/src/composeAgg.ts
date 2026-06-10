import type { ComposeRule, FocalVerdict, VerdictDecision } from "@dusk/core-schema";

/**
 * `compose` aggregation (RFC §3.2, App. A.4; Plan P2-T16). Combines per-triple
 * focal verdicts into the intent-level decision. `focal_verdict: "pass"` means
 * the triple's claim holds (after runtime polarity inversion).
 *
 *  - all:     accept iff every focal passes (reject on any fail)
 *  - any:     accept iff at least one focal passes
 *  - none:    reject iff any focal claim holds (accept iff every focal fails)
 *  - implies: vacuous accept when the antecedent is false; else reduces to `all`
 *             over the consequent focal verdicts
 */
export function aggregateDecision(
  compose: ComposeRule,
  focalVerdicts: readonly FocalVerdict[],
  opts: { antecedentHeld?: boolean } = {},
): VerdictDecision {
  switch (compose) {
    case "all":
      return focalVerdicts.every((v) => v === "pass") ? "accept" : "reject";
    case "any":
      return focalVerdicts.some((v) => v === "pass") ? "accept" : "reject";
    case "none":
      return focalVerdicts.some((v) => v === "pass") ? "reject" : "accept";
    case "implies":
      if (opts.antecedentHeld === false) return "accept";
      return focalVerdicts.every((v) => v === "pass") ? "accept" : "reject";
  }
}
