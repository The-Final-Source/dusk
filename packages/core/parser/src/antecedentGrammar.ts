import type { Intent } from "@dusk/core-schema";

/**
 * Antecedent objects for `compose: implies` must be resolvable references (RFC §3.2.1):
 * an intent path, an intent path with an `[aspect]` suffix, or a directory glob.
 * The closed predicate vocabulary itself is enforced by the schema; this checks the
 * object shape so the parser can raise `decoration_parse_error` at load time.
 */
const REFERENCE = /^[a-z0-9]+(?:[-/][a-z0-9]+)*(?:\[[a-z0-9-]+\])?$/;
const GLOB = /^[a-z0-9]+(?:[-/][a-z0-9]+)*\/\*\*?$/;

export function isResolvableReference(object: string): boolean {
  return REFERENCE.test(object) || GLOB.test(object);
}

export function checkAntecedentGrammar(intent: Intent): { ok: true } | { ok: false; messages: string[] } {
  if (intent.compose !== "implies" || !intent.antecedent) return { ok: true };
  const messages: string[] = [];
  for (const antecedent of intent.antecedent) {
    if (!isResolvableReference(antecedent.object)) {
      messages.push(
        `antecedent "${antecedent.id}" object "${antecedent.object}" is not a resolvable reference (expected an intent path, path[aspect], or directory glob)`,
      );
    }
  }
  return messages.length > 0 ? { ok: false, messages } : { ok: true };
}
