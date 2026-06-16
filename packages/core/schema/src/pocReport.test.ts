import { describe, expect, test } from "vitest";

import { PocExploratorySchema, PocGatingSchema, PocReportSchema } from "./pocReport.js";

const passingGating = {
  handwritten_application_commit_count: { value: 0, threshold: "== 0", pass: true },
  endpoints_not_pipeline_landed: { value: 0, threshold: "== 0", pass: true },
  gate_false_positive_count: { value: 0, threshold: "== 0", pass: true },
  intents_not_dialog_authored: { value: 0, threshold: "== 0", pass: true },
  full_pyramid_on_live_infra: { value: "green", threshold: "green", pass: true },
  static_analysis_both_modes: { value: "clean", threshold: "clean", pass: true },
  pass: true,
};

const exploratory = {
  gating: false as const,
  dialog_turn_distribution: { "3": 2, "5": 1 },
  stage3_acceptance_rate: 0.8,
  iteration_distribution: { "2": 3, "4": 1 },
  pause_resume_count: 1,
  intent_granularity: { intent_count: 14, triple_count: 31, mean_triples_per_intent: 2.21 },
  time_to_endpoint: [{ endpoint: "GET /notifications", ms: 412000 }],
  friction_observations: ["Stage-2 surfaced the pagination overlap on the third intent"],
  friction_commits: [{ sha: "abc1234", summary: "tune dusk-author Stage-2 tension prompt" }],
};

describe("P6 §1.2 — PocReport gating/exploratory split is structural", () => {
  test("a canonical gating section parses", () => {
    expect(PocGatingSchema.parse(passingGating).pass).toBe(true);
  });

  test("a canonical exploratory section parses and is labeled gating:false", () => {
    expect(PocExploratorySchema.parse(exploratory).gating).toBe(false);
  });

  test("a full canonical PocReport parses", () => {
    const report = {
      schema_version: 1 as const,
      poc_repo: "notifications-poc",
      window: { initialized_at: "2026-06-15T10:00:00.000Z", evaluated_at: "2026-06-15T18:00:00.000Z" },
      gating: passingGating,
      exploratory,
    };
    expect(PocReportSchema.parse(report)).toEqual(report);
  });

  test("an exploratory metric in the gating section is rejected (.strict())", () => {
    const polluted = { ...passingGating, stage3_acceptance_rate: 0.8 };
    expect(() => PocGatingSchema.parse(polluted)).toThrow();
  });

  test("gating:true is rejected — the exploratory section can never claim gating", () => {
    expect(() => PocExploratorySchema.parse({ ...exploratory, gating: true })).toThrow();
  });

  test("a failed hard gate is representable (value above threshold, pass:false)", () => {
    const failing = {
      ...passingGating,
      handwritten_application_commit_count: { value: 2, threshold: "== 0", pass: false },
      pass: false,
    };
    expect(PocGatingSchema.parse(failing).pass).toBe(false);
  });
});
