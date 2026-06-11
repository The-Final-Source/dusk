import { describe, expect, it } from "vitest";

import { AuditReportSchema, type AuditReport, type OrganicCohort } from "./auditReport.js";
import { AuditThresholdsSchema, type AuditThresholds } from "./auditThresholds.js";
import { BenchmarkReportSchema, type BenchmarkReport } from "./benchmarkReport.js";
import { DogfoodReportSchema, type DogfoodReport } from "./dogfoodReport.js";
import { StaticAnalysisReportSchema, type StaticAnalysisReport } from "./staticAnalysisReport.js";

// 1.2 — Phase-5 v1.x-facing artifact schemas (design D10). Unit-only: pure
// transforms; one canonical-fixture validation per schema, plus the
// `frozen: true` literal rejection.

const thresholds: AuditThresholds = {
  schema_version: 1,
  calibrated_at: "2026-06-11T00:00:00.000Z",
  calibration_fixture_ids: ["verification/calibration-known-good-1", "verification/calibration-controversial-1"],
  frozen: true,
  axis1_variance: { max_entropy_known_bad: 0.469, min_entropy_controversial: 0.4 },
  axis2_similarity: { max_token_overlap_low_precision_flag: 0.6 },
  axis3_citation: { min_pct_fixtures_aligned_4of5: 0.8, max_pct_fixtures_all_unaligned: 0.05 },
  confidence_intervals: { max_entropy_known_bad: [0.3, 0.6] },
};

describe("AuditThresholds", () => {
  it("parses a canonical frozen thresholds file", () => {
    expect(AuditThresholdsSchema.parse(thresholds)).toEqual(thresholds);
  });

  it("rejects frozen: false — the file IS the freeze", () => {
    const result = AuditThresholdsSchema.safeParse({ ...thresholds, frozen: false });
    expect(result.success).toBe(false);
  });
});

const organicCohort: OrganicCohort = {
  selection: "first-call-rejected",
  precision_not_comparable_to_curated: true,
  sample_count: 1,
  samples: [
    {
      confirmation_of_trace_id: "tr_1",
      confirmation_trace_ids: ["tr_2", "tr_3"],
      confirmation_pass_outcome: "confirmed_reject",
    },
  ],
};

describe("AuditReport", () => {
  const report: AuditReport = {
    schema_version: 1,
    run_id: "audit_20260611000000",
    generated_at: "2026-06-11T00:00:00.000Z",
    n_per_fixture: 10,
    curated: {
      fixtures: [
        {
          fixture_id: "verification/quantifier-1",
          n_calls: 10,
          verdict_counts: { accept: 0, reject: 10 },
          axis1_entropy: 0,
          axis2_mean_token_overlap: 0.42,
          axis3_citation_tiers: ["aligned", "aligned", "aligned", "aligned", "aligned", "aligned", "aligned", "aligned", "adjacent", "aligned"],
          axis3_pct_aligned: 0.9,
          no_citation_flag: false,
        },
      ],
      scores: {
        axis1_variance: { mean_entropy_known_bad: 0, pass: true },
        axis2_similarity: { mean_token_overlap: 0.42, pass: true },
        axis3_citation: { pct_fixtures_aligned_4of5: 1, pct_fixtures_all_unaligned: 0, pass: true },
      },
    },
    quadrant_flags: [
      { variant: "standard", high_similarity: false, low_precision: false, rubber_stamp_quadrant: false, no_citation_flag: false },
      { variant: "rubber-stamp", high_similarity: true, low_precision: true, rubber_stamp_quadrant: true, no_citation_flag: false },
    ],
    organic: organicCohort,
  };

  it("parses a canonical three-axis report with cohorts and quadrant flags", () => {
    expect(AuditReportSchema.parse(report)).toEqual(report);
  });

  it("rejects an organic cohort without its bias annotations", () => {
    const blended = {
      ...report,
      organic: { ...organicCohort, precision_not_comparable_to_curated: false },
    };
    expect(AuditReportSchema.safeParse(blended).success).toBe(false);
  });

  it("rejects n_per_fixture below the N≥10 protocol", () => {
    expect(AuditReportSchema.safeParse({ ...report, n_per_fixture: 5 }).success).toBe(false);
  });

  it("reserves dialog_transcript_refs as optional (design Q2)", () => {
    const withRefs = { ...report, dialog_transcript_refs: ["dlg_1"] };
    expect(AuditReportSchema.parse(withRefs).dialog_transcript_refs).toEqual(["dlg_1"]);
  });
});

const flakeCharacterization = {
  gating: false,
  n_first_calls: 40,
  first_call_reject_rate: 0.05,
  confirmation_dismissal_rate: 1,
  tolerance_bands: { first_call_reject: [0, 0.12], confirmation_dismissal: [0.7, 1] },
} as const;

describe("BenchmarkReport", () => {
  const report: BenchmarkReport = {
    schema_version: 1,
    run_id: "bench_20260611000000",
    generated_at: "2026-06-11T00:00:00.000Z",
    models: ["m1", "m2"],
    fixture_count: 4,
    per_model_per_class_accuracy: [
      {
        model: "m1",
        classes: [
          { class: "mechanical", total: 2, caught: 2, accuracy: 1 },
          { class: "verification", total: 2, caught: 1, accuracy: 0.5 },
        ],
      },
    ],
    per_role_per_model: [{ role: "verifier", model: "m1", calls: 4, mean_latency_ms: 120, total_cost_usd: 0.02 }],
    agreement_matrix: { models: ["m1", "m2"], rates: [[1, 0.75], [0.75, 1]] },
    flake_characterization: {
      ...flakeCharacterization,
      tolerance_bands: { first_call_reject: [0, 0.12], confirmation_dismissal: [0.7, 1] },
    },
  };

  it("parses a canonical multi-model report", () => {
    expect(BenchmarkReportSchema.parse(report)).toEqual(report);
  });

  it("rejects a flake characterization claiming to gate", () => {
    const gated = { ...report, flake_characterization: { ...flakeCharacterization, gating: true } };
    expect(BenchmarkReportSchema.safeParse(gated).success).toBe(false);
  });
});

describe("DogfoodReport", () => {
  const report: DogfoodReport = {
    schema_version: 1,
    package: "packages/shared",
    window: { first_decorated_commit_at: "2026-06-11T00:00:00.000Z", evaluated_at: "2026-06-25T00:00:00.000Z", days: 14 },
    gating: {
      e2e_implement_success_count: { value: 1, threshold: ">= 1", pass: true },
      gate_false_positive_count: { value: 0, threshold: "== 0", pass: true },
      worked_example_regression: { value: "clean", threshold: "clean", pass: true },
      package_test_suite: { value: "green", threshold: "green", pass: true },
      pass: true,
    },
    exploratory: {
      gating: false,
      iteration_distribution: { "1": 3, "2": 1 },
      author_branching_distribution: { "1": 4 },
      stuckness_fire_count: 0,
      livelock_count: 0,
      doctor_finding_trend: [{ at: "2026-06-12T00:00:00.000Z", findings: 2 }],
      api_expansion: { begun: true, notes: "authored first api intents" },
      friction_observations: ["verifier prompt needed clearer focal framing"],
      friction_commits: [{ sha: "abc1234", summary: "feat(roles): clarify verifier focal framing" }],
    },
  };

  it("parses a canonical report with gating/exploratory structurally separated", () => {
    expect(DogfoodReportSchema.parse(report)).toEqual(report);
  });

  it("rejects exploratory metrics smuggled into the gating section", () => {
    const smuggled = {
      ...report,
      gating: { ...report.gating, iteration_distribution: { "1": 3 } },
    };
    expect(DogfoodReportSchema.safeParse(smuggled).success).toBe(false);
  });

  it("rejects an exploratory section claiming to gate", () => {
    const gated = { ...report, exploratory: { ...report.exploratory, gating: true } };
    expect(DogfoodReportSchema.safeParse(gated).success).toBe(false);
  });
});

describe("StaticAnalysisReport", () => {
  const report: StaticAnalysisReport = {
    schema_version: 1,
    generated_at: "2026-06-11T00:00:00.000Z",
    mode: "strict-unknowns",
    findings: [
      {
        class: "s_not_subset_d",
        file: "src/notify.ts",
        line: 12,
        intents_involved: ["sync/pubsub-on-create"],
        suggestion: "callee publishSync participates in sync/pubsub-on-create — decorate the unit or decompose the call",
        severity: "warning",
      },
      {
        class: "undecorated_callee",
        file: "src/notify.ts",
        line: 18,
        intents_involved: [],
        suggestion: "callee buildRows is undecorated — its intent participation is unknown",
        severity: "info",
      },
      {
        class: "conflicts_co_decoration",
        file: "src/page.ts",
        line: 4,
        intents_involved: ["api/pagination/cursor-only", "api/pagination/offset"],
        suggestion: "intents are linked `conflicts` — the same region must not claim both",
        severity: "error",
      },
    ],
    density_baseline: [{ file: "src/notify.ts", decorated_units: 3, undecorated_units: 1 }],
  };

  it("parses a canonical report with findings and the density baseline", () => {
    expect(StaticAnalysisReportSchema.parse(report)).toEqual(report);
  });

  it("rejects an unknown finding class", () => {
    const bad = {
      ...report,
      findings: [{ ...report.findings[0], class: "vibes" }],
    };
    expect(StaticAnalysisReportSchema.safeParse(bad).success).toBe(false);
  });
});
