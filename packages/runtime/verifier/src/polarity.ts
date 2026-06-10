import type { FocalVerdict, Polarity } from "@dusk/core-schema";

/**
 * Runtime polarity inversion at the procedure boundary (RFC §3.3, App. D.17;
 * design D7). The LLM only ever answers the AFFIRMATIVE question (does the claim
 * hold?). The runtime — never the LLM — converts that to a focal verdict,
 * inverting when polarity is negative. Constituent negation inside a noun phrase
 * does NOT reach here as a polarity flip; only the triple's `polarity` field does.
 */
export function focalVerdictFromAffirmative(affirmativeHolds: boolean, polarity: Polarity): FocalVerdict {
  const satisfied = polarity === "negative" ? !affirmativeHolds : affirmativeHolds;
  return satisfied ? "pass" : "fail";
}
