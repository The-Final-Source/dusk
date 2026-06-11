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

export type TripleNegationFinding = NegationFinding & { triple_id: string; path: string; message: string };

/**
 * The single orchestration of the negation rule over one triple's slots —
 * shared by `loadIntent` (parser gate) and `validateMatrixPredicateNegation`
 * (Author Stage 4.5) so the loop and the violation message exist exactly once.
 */
export function findTripleNegations(triple: { id: string; subject: string; predicate: string; object: string }): TripleNegationFinding[] {
  const out: TripleNegationFinding[] = [];
  for (const slot of ["subject", "predicate", "object"] as const) {
    const finding = findIllegalNegation(slot, triple[slot]);
    if (finding) {
      out.push({
        ...finding,
        triple_id: triple.id,
        path: `triples.${triple.id}.${slot}`,
        message: `matrix-predicate negation "${finding.marker}" in the ${slot} slot of triple "${triple.id}"`,
      });
    }
  }
  return out;
}
