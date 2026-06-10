import { ANTECEDENT_PREDICATES, RELATES_TO_KINDS } from "@dusk/core-schema";

import { findIllegalNegation, type NegationFinding } from "./negationDetector.js";
import { isResolvableReference } from "./antecedentGrammar.js";
import { loadIntent, type IntentLoadResult } from "./loadIntent.js";

/**
 * The four Stage-4.5 validation primitives (Phase-4 design D3). These are the
 * SAME rules the Phase-1 parser + PreToolUse gate enforce — thin named entry
 * points over the single-source implementations (`findIllegalNegation`, the
 * closed `ANTECEDENT_PREDICATES` / `RELATES_TO_KINDS` vocabularies,
 * `isResolvableReference`, `loadIntent`). The Author runtime imports these
 * directly; rule drift between Author and gate is impossible by construction.
 */

export type ValidationViolation = {
  code: "matrix_predicate_negation" | "antecedent_grammar" | "relates_to_kind" | "schema_invalid";
  path: string;
  message: string;
};

type TripleLike = { id: string; subject: string; predicate: string; object: string };
type AntecedentLike = { id: string; subject: string; predicate: string; object: string };
type RelatesToLike = { kind: string; target: string };

/** Matrix/constituent negation rule over one triple's slots (RFC §3.1.1). */
export function validateMatrixPredicateNegation(triple: TripleLike): ValidationViolation[] {
  const out: ValidationViolation[] = [];
  for (const slot of ["subject", "predicate", "object"] as const) {
    const finding: NegationFinding | null = findIllegalNegation(slot, triple[slot]);
    if (finding) {
      out.push({
        code: "matrix_predicate_negation",
        path: `triples.${triple.id}.${slot}`,
        message: `matrix-predicate negation "${finding.marker}" in the ${slot} slot of triple "${triple.id}"`,
      });
    }
  }
  return out;
}

/** Closed antecedent vocabulary + resolvable-reference objects for `compose: implies` (RFC §3.2.1). */
export function validateAntecedentGrammar(intent: { compose?: string; antecedent?: AntecedentLike[] }): ValidationViolation[] {
  if (intent.compose !== "implies" || !intent.antecedent) return [];
  const out: ValidationViolation[] = [];
  for (const antecedent of intent.antecedent) {
    if (!(ANTECEDENT_PREDICATES as readonly string[]).includes(antecedent.predicate)) {
      out.push({
        code: "antecedent_grammar",
        path: `antecedent.${antecedent.id}.predicate`,
        message: `antecedent "${antecedent.id}" predicate "${antecedent.predicate}" is outside the closed vocabulary (${ANTECEDENT_PREDICATES.join(" | ")})`,
      });
    }
    if (!isResolvableReference(antecedent.object)) {
      out.push({
        code: "antecedent_grammar",
        path: `antecedent.${antecedent.id}.object`,
        message: `antecedent "${antecedent.id}" object "${antecedent.object}" is not a resolvable reference (expected an intent path, path[aspect], or directory glob)`,
      });
    }
  }
  return out;
}

/** Five typed `relates_to` kinds — never `refines` (RFC §2.1, App. D.19). */
export function validateRelatesToKinds(intent: { relates_to?: RelatesToLike[] }): ValidationViolation[] {
  const out: ValidationViolation[] = [];
  for (const rel of intent.relates_to ?? []) {
    if (!(RELATES_TO_KINDS as readonly string[]).includes(rel.kind)) {
      out.push({
        code: "relates_to_kind",
        path: `relates_to.${rel.target}`,
        message: `relates_to kind "${rel.kind}" is not one of the five typed kinds (${RELATES_TO_KINDS.join(" | ")})`,
      });
    }
  }
  return out;
}

/** Full v2 schema validation including parser-level rules (path-to-id, negation, antecedents). */
export function validateAtomicIntent(raw: unknown, options: { expectedId?: string } = {}): IntentLoadResult {
  return loadIntent(raw, options);
}
