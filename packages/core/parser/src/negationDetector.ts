/**
 * Matrix/constituent negation rule (RFC §3.1.1), POS-aware, no ML dependency.
 *
 * - PREDICATE slot: reject the full matrix-negation lexicon. This is the load-bearing
 *   rule (also reused by PreToolUse gate check 10 on @intent-support predicates).
 * - SUBJECT / OBJECT slots: constituent negation inside a noun phrase is LEGAL, so these
 *   slots are permissive. This eliminates the false positives the rule exists to avoid
 *   (e.g. "a function with no required arguments", "a sandboxed environment free of
 *   network access"). Negation that genuinely must be a verdict-level claim is expressed
 *   structurally via `polarity: negative`, never smuggled into a slot.
 */
export type Slot = "subject" | "predicate" | "object";

export type NegationFinding = { slot: Slot; value: string; marker: string };

const MATRIX_PREDICATE_MARKERS = [
  "does not",
  "do not",
  "did not",
  "is not",
  "are not",
  "was not",
  "were not",
  "cannot",
  "must not",
  "never",
  "not",
  "fails to",
  "refrains from",
  "absent",
  "missing",
  "lacks",
  "lacking",
  "omits",
  "excludes",
  "forbids",
  "prohibits",
  "prevents",
  "disallows",
  "denies",
  "rejects",
  "refuses",
  "bars",
  "devoid of",
  "free of",
  "free from",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns the offending marker for a slot value, or null when the value is acceptable. */
export function findIllegalNegation(slot: Slot, value: string): NegationFinding | null {
  if (slot !== "predicate") return null; // constituent negation in subject/object is legal
  const text = value.toLowerCase();
  if (/n['’]t\b/.test(text)) return { slot, value, marker: "n't" };
  for (const marker of MATRIX_PREDICATE_MARKERS) {
    const pattern = new RegExp(`(?:^|[^a-z])${escapeRegExp(marker)}(?![a-z])`, "i");
    if (pattern.test(text)) return { slot, value, marker };
  }
  return null;
}
