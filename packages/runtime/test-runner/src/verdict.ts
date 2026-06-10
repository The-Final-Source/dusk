import type { TestVerdict } from "@dusk/core-schema";

import type { TestResult } from "./vitest.js";

/**
 * TestVerdict assembly (RFC App. A.5; 9.3). A `covers-X` triple is satisfied iff
 * ≥1 mapped test passes AND no mapped test for it fails. The per-test → triple
 * mapping is at the test-intent file granularity: every captured test in the
 * test-intent's files is mapped to the test-intent's covered triples.
 */

export function assembleTestVerdict(input: {
  testIntentPath: string;
  coveredTriples: string[];
  results: TestResult[];
}): TestVerdict {
  const mapped = input.results.map((r) => r.title);
  const anyPass = input.results.some((r) => r.status === "passed");
  const anyFail = input.results.some((r) => r.status === "failed");
  const tripleSatisfied = anyPass && !anyFail;
  const duration = input.results.reduce((sum, r) => sum + r.duration, 0);

  const per_triple = input.coveredTriples.map((triple_id) => ({
    triple_id,
    verdict: (tripleSatisfied ? "pass" : "fail") as "pass" | "fail",
    mapped_tests: mapped,
    rationale: tripleSatisfied ? `${mapped.length} mapped test(s) passed` : "no passing test (or a failure) for this triple",
  }));

  const decision = per_triple.length > 0 && per_triple.every((t) => t.verdict === "pass") ? "pass" : "fail";

  return {
    test_intent_path: input.testIntentPath,
    decision,
    per_triple,
    mapped_tests: mapped,
    rationale: decision === "pass" ? "all covered triples satisfied by passing tests" : "one or more covered triples unsatisfied",
    duration,
  };
}
