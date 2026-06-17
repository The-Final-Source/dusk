import type { DuskTestRunResult, TestVerdict } from "@dusk/core-schema";

/**
 * TestVerdict assembly (RFC App. A.5; App. D.34, decision ①). Built from Dusk's
 * OWN result schema (`DuskTestRunResult`) and the content outcome the mechanical
 * floor (`readDuskTestResult`) already decided — NOT from the former
 * `anyPass && !anyFail` silence-inference over a tool's per-test vocabulary. A
 * `covers-X` triple is satisfied (content `pass`) iff the floor read
 * `passed>0 ∧ failed==0 ∧ completed`; a content `fail` is `failed>0`. The
 * absent/incomplete/truncated cases never reach here — they resolve to
 * `no_verdict` upstream.
 */

export function assembleTestVerdict(input: {
  testIntentPath: string;
  coveredTriples: string[];
  result: DuskTestRunResult;
  /** The content outcome the Dusk-result-schema floor already decided. */
  outcome: "pass" | "fail";
}): TestVerdict {
  const mapped = input.result.cases.map((c) => c.name);
  const duration = input.result.cases.reduce((sum, c) => sum + c.duration_ms, 0);

  const per_triple = input.coveredTriples.map((triple_id) => ({
    triple_id,
    verdict: input.outcome,
    mapped_tests: mapped,
    rationale:
      input.outcome === "pass"
        ? `${input.result.passed} passing test(s), 0 failing`
        : `${input.result.failed} failing test(s)`,
  }));

  return {
    test_intent_path: input.testIntentPath,
    decision: input.outcome,
    per_triple,
    mapped_tests: mapped,
    rationale: input.outcome === "pass" ? "all covered triples satisfied by passing tests" : "one or more covered triples have a failing test",
    duration,
  };
}
