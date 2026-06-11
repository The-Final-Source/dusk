import { z } from "zod";

/**
 * Pre-registered fresh-Verifier audit thresholds — Phase 5 design D1.
 *
 * The checked-in `audit-thresholds.json` IS the freeze: written by
 * `dusk benchmark --calibrate-audit` over the manifest-declared calibration
 * split only, with provenance. The audit refuses to score when the file is
 * absent, `frozen !== true`, or the calibration set intersects the scored set —
 * calibration data is never test data, by construction.
 */

export const AuditThresholdsSchema = z
  .object({
    schema_version: z.literal(1),
    /** Clock-injected ISO 8601 — when the bars were calibrated. */
    calibrated_at: z.string(),
    /** The held-out controversial/known-good split the bars were calibrated on. */
    calibration_fixture_ids: z.array(z.string()),
    /** Literal — the file IS the freeze. `frozen: false` does not parse. */
    frozen: z.literal(true),
    axis1_variance: z
      .object({
        max_entropy_known_bad: z.number().min(0),
        min_entropy_controversial: z.number().min(0),
      })
      .strict(),
    axis2_similarity: z
      .object({
        /** Token-overlap above this, combined with low Axis-3 precision, flags the rubber-stamp quadrant. */
        max_token_overlap_low_precision_flag: z.number().min(0).max(1),
      })
      .strict(),
    axis3_citation: z
      .object({
        /** ≥ 0.80 per RFC §7.5.1 — pct of fixtures with ≥4-of-5 calls `aligned`. */
        min_pct_fixtures_aligned_4of5: z.number().min(0).max(1),
        /** ≤ 0.05 per RFC §7.5.1 — pct of fixtures with every call `unaligned`. */
        max_pct_fixtures_all_unaligned: z.number().min(0).max(1),
      })
      .strict(),
    /** Calibration confidence intervals reported alongside the bars (design risk mitigation). */
    confidence_intervals: z.record(z.tuple([z.number(), z.number()])).optional(),
  })
  .strict();
export type AuditThresholds = z.infer<typeof AuditThresholdsSchema>;
