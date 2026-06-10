import type { SubAgentTrace } from "@dusk/core-schema";

/** The captured assembled prompt for a trace (test/benchmark mode only). */
export const rawPromptOf = (trace: SubAgentTrace | undefined): string | undefined => trace?.raw_prompt;

/**
 * Precise identifier-absence check (P2-T1 / P2-T3): assert the prompt contains
 * NONE of the given identifiers (intent ids, file paths, evidence spans, seeded
 * diagnosis substrings). Returns the offending matches so failures are legible.
 */
export function containsNone(text: string, identifiers: readonly string[]): { ok: boolean; offending: string[] } {
  const offending = identifiers.filter((id) => id.length > 0 && text.includes(id));
  return { ok: offending.length === 0, offending };
}

/** Assert the prompt contains all of the given fragments (scoped-evidence presence). */
export function containsAll(text: string, fragments: readonly string[]): { ok: boolean; missing: string[] } {
  const missing = fragments.filter((fragment) => !text.includes(fragment));
  return { ok: missing.length === 0, missing };
}

/**
 * The affirmative-framing contract (P2-T5): the assembled Verifier prompt must
 * never pose a negated question. Flags explicit sentence-level negation markers.
 */
const NEGATION_MARKERS = ["does NOT", "does not", "do NOT", "do not", "is NOT", "is not", "must not", "never "];

export function hasNoNegationQuestion(text: string): { ok: boolean; offending: string[] } {
  const offending = NEGATION_MARKERS.filter((marker) => text.includes(marker));
  return { ok: offending.length === 0, offending };
}
