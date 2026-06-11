import { z } from "zod";

/**
 * Fresh-Verifier audit report — Phase 5 design D10 (a v1.x-facing artifact
 * format). Three axes (verdict-variance entropy, rationale token-overlap,
 * structural citation precision — NO LLM-judge), cohort sections (curated
 * baseline + bias-annotated organic confirmation-pass cohort), and the RFC
 * §7.5.1 quadrant flags.
 */

export const CITATION_TIERS = ["aligned", "adjacent", "unaligned"] as const;
export const CitationTierSchema = z.enum(CITATION_TIERS);
export type CitationTier = z.infer<typeof CitationTierSchema>;

export const AuditFixtureResultSchema = z
  .object({
    fixture_id: z.string(),
    n_calls: z.number().int().min(1),
    verdict_counts: z
      .object({ accept: z.number().int().min(0), reject: z.number().int().min(0) })
      .strict(),
    /** Axis 1 — Shannon entropy over the N verdicts (bits). */
    axis1_entropy: z.number().min(0),
    /** Axis 2 — mean pairwise token overlap over the N rationales. */
    axis2_mean_token_overlap: z.number().min(0).max(1),
    /** Axis 3 — one citation tier per call, via the structural scorer. */
    axis3_citation_tiers: z.array(CitationTierSchema),
    axis3_pct_aligned: z.number().min(0).max(1),
    /** Raised when a call produced no `file:line` citation at all (its own actionable signal). */
    no_citation_flag: z.boolean(),
  })
  .strict();
export type AuditFixtureResult = z.infer<typeof AuditFixtureResultSchema>;

/** Per-axis scores against the pre-registered frozen bars. */
export const AuditAxisScoresSchema = z
  .object({
    axis1_variance: z
      .object({ mean_entropy_known_bad: z.number().min(0), pass: z.boolean() })
      .strict(),
    axis2_similarity: z
      .object({ mean_token_overlap: z.number().min(0).max(1), pass: z.boolean() })
      .strict(),
    axis3_citation: z
      .object({
        pct_fixtures_aligned_4of5: z.number().min(0).max(1),
        pct_fixtures_all_unaligned: z.number().min(0).max(1),
        pass: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type AuditAxisScores = z.infer<typeof AuditAxisScoresSchema>;

/** RFC §7.5.1 quadrant interpretation per audited prompt variant. */
export const AuditQuadrantFlagSchema = z
  .object({
    variant: z.string(),
    high_similarity: z.boolean(),
    low_precision: z.boolean(),
    /** High-similarity × Low-precision — the correlated-sympathy-bias signature. */
    rubber_stamp_quadrant: z.boolean(),
    /** All-`unaligned` with no citations anywhere — flagged, never silently degraded. */
    no_citation_flag: z.boolean(),
  })
  .strict();
export type AuditQuadrantFlag = z.infer<typeof AuditQuadrantFlagSchema>;

/**
 * The organic confirmation-pass cohort (P5-T4). Selection-bias annotations are
 * literals — the no-blended-metrics rule enforced in the artifact shape.
 */
export const OrganicCohortSchema = z
  .object({
    selection: z.literal("first-call-rejected"),
    precision_not_comparable_to_curated: z.literal(true),
    sample_count: z.number().int().min(0),
    samples: z.array(
      z
        .object({
          /** Trace id of the original first-call reject the confirmations reference. */
          confirmation_of_trace_id: z.string(),
          confirmation_trace_ids: z.array(z.string()),
          confirmation_pass_outcome: z.enum(["confirmed_reject", "flaky_verdict_dismissed"]).optional(),
        })
        .strict()
    ),
  })
  .strict();
export type OrganicCohort = z.infer<typeof OrganicCohortSchema>;

export const AuditReportSchema = z
  .object({
    schema_version: z.literal(1),
    run_id: z.string(),
    generated_at: z.string(),
    /** N independent Verifier calls per fixture — the audit's own protocol mandates ≥10. */
    n_per_fixture: z.number().int().min(10),
    /** The curated known-bad baseline, scored against the frozen bars. */
    curated: z
      .object({
        fixtures: z.array(AuditFixtureResultSchema),
        scores: AuditAxisScoresSchema,
      })
      .strict(),
    quadrant_flags: z.array(AuditQuadrantFlagSchema),
    /** Present when the trace stream carried confirmation-pass calls. Never blended into `curated`. */
    organic: OrganicCohortSchema.optional(),
    /** Reserved for v1.x authoring-decision correlation (design Q2). Never scored in v1. */
    dialog_transcript_refs: z.array(z.string()).optional(),
  })
  .strict();
export type AuditReport = z.infer<typeof AuditReportSchema>;
