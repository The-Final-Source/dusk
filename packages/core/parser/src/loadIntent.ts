import { parseIntent, type Intent, type ParseIntentOptions } from "@dusk/core-schema";

import { findTripleNegations } from "./negationDetector.js";
import { checkAntecedentGrammar } from "./antecedentGrammar.js";

export type DecorationParseError = { kind: "decoration_parse_error"; message: string; hint: string; path: string };
export type LoadIssue = { message: string; path: string };

export type IntentLoadResult =
  | { success: true; intent: Intent; warnings: string[] }
  | { success: false; errors: Array<LoadIssue | DecorationParseError>; warnings: string[] };

/**
 * Schema-validate a raw intent and additionally enforce the parser-level rules:
 * matrix-predicate negation in triple predicate slots (RFC §3.1.1) and the
 * `compose: implies` antecedent grammar (RFC §3.2.1). Negation/antecedent failures
 * surface as `decoration_parse_error` with a guidance hint.
 */
export function loadIntent(raw: unknown, options: ParseIntentOptions = {}): IntentLoadResult {
  const base = parseIntent(raw, options);
  if (!base.success) return { success: false, errors: base.errors, warnings: base.warnings };

  const intent = base.intent;
  const errors: Array<LoadIssue | DecorationParseError> = [];

  const triples = [...(intent.triples ?? []), ...(intent.consequent ?? [])];
  for (const triple of triples) {
    for (const finding of findTripleNegations(triple)) {
      errors.push({
        kind: "decoration_parse_error",
        path: finding.path,
        message: finding.message,
        hint: "use polarity: negative instead (see dusk/author/polarity-decision)",
      });
    }
  }

  const grammar = checkAntecedentGrammar(intent);
  if (!grammar.ok) {
    for (const message of grammar.messages) {
      errors.push({ kind: "decoration_parse_error", path: "antecedent", message, hint: "see dusk/author/implies-antecedent-grammar" });
    }
  }

  if (errors.length > 0) return { success: false, errors, warnings: base.warnings };
  return { success: true, intent, warnings: base.warnings };
}
