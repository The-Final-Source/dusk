import { z } from "zod";

/**
 * Per-test-intent verdict — RFC App. A.5; design D8, D14. The Test Runner rolls
 * up real Vitest per-test results into this shape. A `covers-X` triple is
 * satisfied iff ≥1 mapped test passes. Frozen here so Phase 5's audit aggregates
 * over it.
 */

export const TEST_VERDICT_DECISIONS = ["pass", "fail"] as const;
export const TestVerdictDecisionSchema = z.enum(TEST_VERDICT_DECISIONS);
export type TestVerdictDecision = z.infer<typeof TestVerdictDecisionSchema>;

export const PerTripleTestVerdictSchema = z
  .object({
    triple_id: z.string(),
    verdict: TestVerdictDecisionSchema,
    mapped_tests: z.array(z.string()),
    rationale: z.string(),
  })
  .strict();
export type PerTripleTestVerdict = z.infer<typeof PerTripleTestVerdictSchema>;

export const TestVerdictSchema = z
  .object({
    test_intent_path: z.string(),
    decision: TestVerdictDecisionSchema,
    per_triple: z.array(PerTripleTestVerdictSchema),
    /** All mapped test names across triples (App. A.5 top-level field). */
    mapped_tests: z.array(z.string()),
    rationale: z.string(),
    /** Aggregate execution duration in milliseconds. */
    duration: z.number().min(0),
  })
  .strict();
export type TestVerdict = z.infer<typeof TestVerdictSchema>;
