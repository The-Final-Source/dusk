import type { AuditThresholds } from "@dusk/core-schema";

/** A canonical frozen thresholds object for zero-model audit tests. */
export const frozenThresholds = (over: Partial<AuditThresholds> = {}): AuditThresholds => ({
  schema_version: 1,
  calibrated_at: "2026-06-11T00:00:00.000Z",
  calibration_fixture_ids: ["verification/calibration-good-persist-first"],
  frozen: true,
  axis1_variance: { max_entropy_known_bad: 0.5, min_entropy_controversial: 0.2 },
  axis2_similarity: { max_token_overlap_low_precision_flag: 0.6 },
  axis3_citation: { min_pct_fixtures_aligned_4of5: 0.8, max_pct_fixtures_all_unaligned: 0.05 },
  ...over,
});
