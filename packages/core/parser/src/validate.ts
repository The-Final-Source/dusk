import { ANTECEDENT_PREDICATES, RELATES_TO_KINDS } from "@dusk/core-schema";

import { findTripleNegations } from "./negationDetector.js";
import { isResolvableReference } from "./antecedentGrammar.js";
import { loadIntent, type IntentLoadResult } from "./loadIntent.js";

/**
 * The four Stage-4.5 validation primitives (Phase-4 design D3) — named entry
 * points ADDED in Phase 4 as thin adapters over the Phase-1 single-source
 * implementations (`findTripleNegations`, the closed `ANTECEDENT_PREDICATES` /
 * `RELATES_TO_KINDS` vocabularies, `isResolvableReference`, `loadIntent`).
 * `loadIntent` (the parser gate) and these adapters share the SAME leaves, so
 * rule drift between Author and gate is impossible by construction.
 */

export type ValidationViolation = {
  code: "matrix_predicate_negation" | "antecedent_grammar" | "relates_to_kind" | "schema_invalid" | "verify_channel";
  path: string;
  message: string;
};

type TripleLike = { id: string; subject: string; predicate: string; object: string };
type ChannelTripleLike = { id: string; verify?: string; polarity?: string; quantifier?: string };

/**
 * The verification CHANNEL must be honest (RFC App. D.31). The structural channel
 * verifies PRESENCE + decoration coverage — it can witness neither an ABSENCE
 * (negative polarity) nor a CARDINALITY bound (a quantifier). Marking such a
 * claim `verify: structural` would make it pass mechanically without verifying
 * the thing it asserts. These combinations are rejected at authoring time so the
 * author routes them to the semantic channel (or restates them as a positive
 * shape claim) — never a silent vacuous pass.
 */
export function validateVerifyChannel(triple: ChannelTripleLike): ValidationViolation[] {
  if (triple.verify !== "structural") return [];
  const out: ValidationViolation[] = [];
  if (triple.polarity === "negative") {
    out.push({
      code: "verify_channel",
      path: `triple.${triple.id}.verify`,
      message: `triple "${triple.id}" is verify: structural with polarity: negative — the structural channel verifies presence/coverage and cannot witness an absence. Mark it verify: semantic, or restate it as a positive shape claim.`,
    });
  }
  if (triple.quantifier) {
    out.push({
      code: "verify_channel",
      path: `triple.${triple.id}.verify`,
      message: `triple "${triple.id}" is verify: structural with quantifier "${triple.quantifier}" — the structural channel cannot verify a cardinality bound. Mark it verify: semantic.`,
    });
  }
  return out;
}
type AntecedentLike = { id: string; subject: string; predicate: string; object: string };
type RelatesToLike = { kind: string; target: string };

/** Matrix/constituent negation rule over one triple's slots (RFC §3.1.1). */
export function validateMatrixPredicateNegation(triple: TripleLike): ValidationViolation[] {
  return findTripleNegations(triple).map((finding) => ({
    code: "matrix_predicate_negation" as const,
    path: finding.path,
    message: finding.message,
  }));
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
