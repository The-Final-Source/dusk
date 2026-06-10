import type { Intent, Triple } from "@dusk/core-schema";

import type { FocalEvidence, SupportEvidence } from "./evidence.js";

/**
 * Affirmative prompt builder (RFC §3.3, §9.5; design D7; Plan P2-T5/T17). Poses
 * EVERY triple as the affirmative question regardless of polarity — the LLM is
 * never asked a negated question. Annotates the `quantifier` cardinality bound
 * within the named `scope`. For `compose: implies`, the caller passes ONLY the
 * consequent triples, so antecedents never appear in the assembled payload.
 */
export type TripleToJudge = {
  triple: Triple;
  focal: FocalEvidence[];
  support: SupportEvidence[];
};

/** Cardinality phrase for a quantifier — always count-positive, never "not"/"never". */
function quantifierPhrase(quantifier: string): string {
  switch (quantifier) {
    case "at-least-one":
      return "at least once";
    case "each":
      return "in every applicable case";
    case "exactly-one":
      return "exactly once";
    case "at-most-one":
      return "at most once";
    case "none":
      return "exactly zero times";
    default: {
      const m = quantifier.match(/^at-(least|most)-(\d+)$/);
      if (m) return `at ${m[1]} ${m[2]} times`;
      return "at least once";
    }
  }
}

/** The affirmative question for a triple — no negation, polarity not mentioned. */
export function buildAffirmativeQuestion(triple: Triple): string {
  const claim = `${triple.subject} ${triple.predicate} ${triple.object}`;
  if (!triple.quantifier) return `In this code, does the claim "${claim}" hold?`;
  const cardinality = quantifierPhrase(triple.quantifier);
  const scope = triple.scope ? ` ${triple.scope}` : "";
  return `In this code, does the claim "${claim}" hold ${cardinality}${scope}?`;
}

const supportId = (tripleId: string, idx: number): string => `${tripleId}-s${idx + 1}`;

const OUTPUT_CONTRACT =
  'Respond with ONLY a JSON object of this exact shape (no prose, no code fences):\n' +
  '{"triples":[{"triple_id":"<id>","affirmative_holds":true|false,"rationale":"<one sentence quoting the decisive line>",' +
  '"supports":[{"id":"<support id>","triple_verdict":"matches"|"mismatch"|"vague"}]}]}';

/** Build the user prompt presenting the triples-to-judge with scoped evidence. */
export function buildVerifierUserPrompt(intent: Intent, triples: readonly TripleToJudge[]): string {
  const blocks = triples.map(({ triple, focal, support }) => {
    const focalLines = focal.length
      ? focal.map((f) => `    - ${f.file}:${f.lines[0]} | ${f.quote}`).join("\n")
      : "    (no focal evidence)";
    const supportLines = support.length
      ? support
          .map((s, i) => `    - [${supportId(triple.id, i)}] ${s.file}:${s.lines[0]} | ${s.quote} | NL triple: ${JSON.stringify(s.support_triple)}`)
          .join("\n")
      : "    (no support claims)";
    return [
      `Triple ${triple.id}:`,
      `  Question: ${buildAffirmativeQuestion(triple)}`,
      `  Focal evidence:`,
      focalLines,
      `  Support claims:`,
      supportLines,
    ].join("\n");
  });

  return [
    `Intent: ${intent.id}`,
    `Description: ${intent.description}`,
    "",
    "For EACH triple below, judge whether the affirmative claim holds against the focal evidence.",
    "For EACH support claim, judge whether its NL triple accurately describes the quoted statement",
    '("matches" = accurate; "mismatch" = claims something the statement does not do; "vague" = too underspecified).',
    "",
    blocks.join("\n\n"),
    "",
    OUTPUT_CONTRACT,
  ].join("\n");
}

export { supportId };
