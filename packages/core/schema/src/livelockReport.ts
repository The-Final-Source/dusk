import { z } from "zod";

import { PolaritySchema } from "./primitives.js";

/**
 * Test-Verifier livelock report — RFC §3.4.1; design D14. Emitted when the
 * three-condition detector fires (same triple rejected ≥3 iters + slot-focus
 * ≥80% + ≥3 distinct taxonomy approaches). Frozen here; Phase 4 rewires
 * `modify_triple` to a `dusk_author_continue` flow but the report shape is
 * stable.
 */

export const SLOT_FOCI = ["subject", "predicate", "object"] as const;
export const SlotFocusSchema = z.enum(SLOT_FOCI);
export type SlotFocus = z.infer<typeof SlotFocusSchema>;

export const LivelockResolutionVerbSchema = z.enum(["accept_test_as_is", "modify_triple", "escalate"]);
export type LivelockResolutionVerb = z.infer<typeof LivelockResolutionVerbSchema>;

export const FailingTripleSchema = z
  .object({
    subject: z.string(),
    predicate: z.string(),
    object: z.string(),
    polarity: PolaritySchema,
  })
  .strict();
export type FailingTriple = z.infer<typeof FailingTripleSchema>;

export const EngineerAttemptSchema = z
  .object({
    approach_label: z.string(),
    test_excerpt: z.string(),
    verifier_rejection_summary: z.string(),
    triple_slot_focus: SlotFocusSchema.nullable(),
  })
  .strict();
export type EngineerAttempt = z.infer<typeof EngineerAttemptSchema>;

export const VerifierPersistentRationaleSchema = z
  .object({
    /** slot → concentration share in [0,1] (the ≥0.8 condition is read off this). */
    slot_focus_distribution: z.record(z.number()),
    common_phrase: z.string(),
    full_rationales: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type VerifierPersistentRationale = z.infer<typeof VerifierPersistentRationaleSchema>;

export const SuggestedResolutionSchema = z
  .object({
    verb: LivelockResolutionVerbSchema,
    requires: z.string(),
    description: z.string().optional(),
  })
  .passthrough();
export type SuggestedResolution = z.infer<typeof SuggestedResolutionSchema>;

export const TestVerifierLivelockReportSchema = z
  .object({
    bead_id: z.string(),
    test_intent_path: z.string(),
    failing_triple_id: z.string(),
    failing_triple: FailingTripleSchema,
    iterations_rejected: z.number().int().min(0),
    engineer_attempts: z.array(EngineerAttemptSchema),
    verifier_persistent_rationale: VerifierPersistentRationaleSchema,
    suggested_resolutions: z.array(SuggestedResolutionSchema),
  })
  .strict();
export type TestVerifierLivelockReport = z.infer<typeof TestVerifierLivelockReportSchema>;
