import { z } from "zod";

/**
 * The full v9 commit-trailer set as a typed structure — RFC App. A.7; design
 * D10, D14. The `commit` package renders these into the commit message in the
 * fixed App. A.7 order; Phase 5's audit reads them back. Conditional fields
 * (`partial`, `deferred_intents`, `verifier_bypassed_test_intents`) are present
 * ONLY when produced via their gated paths.
 */

export const IntentTrailerSchema = z
  .object({
    intent_path: z.string(),
    aspect_ids: z.array(z.string()),
  })
  .strict();
export type IntentTrailer = z.infer<typeof IntentTrailerSchema>;

export const BypassedTestIntentSchema = z
  .object({
    test_intent_path: z.string(),
    triple_id: z.string(),
  })
  .strict();
export type BypassedTestIntent = z.infer<typeof BypassedTestIntentSchema>;

export const CommitTrailersSchema = z
  .object({
    // Unconditional (App. A.7 order)
    intents: z.array(IntentTrailerSchema),
    test_intents: z.array(z.string()),
    bead_id: z.string(),
    verdict_id: z.string(),
    test_verdict_id: z.string().optional(),
    trace_id: z.string(),
    verifier_model: z.string(),
    test_runner_model: z.string().optional(),
    long_cycle_samples: z.number().int().min(0),
    test_suites_passed: z.number().int().min(0),
    // Conditional
    partial: z.boolean().optional(),
    deferred_intents: z.array(z.string()).optional(),
    verifier_bypassed_test_intents: z.array(BypassedTestIntentSchema).optional(),
  })
  .strict();
export type CommitTrailers = z.infer<typeof CommitTrailersSchema>;
