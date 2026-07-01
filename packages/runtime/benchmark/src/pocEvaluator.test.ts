import type { Intent, StaticAnalysisReport } from "@dusk/core-schema";
import { PocReportSchema } from "@dusk/core-schema";
import { describe, expect, it } from "vitest";

import { evaluatePoc, type PocEvaluatorInput } from "./pocEvaluator.js";
import { parseGitLog } from "./trailerAudit.js";

// Phase-6 §6.1/§6.2 — the PocReport evaluator. Zero-model deterministic pure
// pass. Runs twice over fixed fixture inputs → byte-identical output; the
// emitted report parses against PocReportSchema.

const US = "\x1f";
function record(sha: string, parents: string[], body: string, files: string[]): string {
  return `COMMIT${US}${sha}${US}${parents.join(" ")}${US}${body}${US}${files.join("\n")}`;
}

const FULL_TRAILERS = [
  "feat(api): list endpoint",
  "",
  "Intent: api/notifications/list",
  "Bead-id: bead-001",
  "Verdict-id: verdict-001",
  "Trace-id: trace-001",
  "Verifier-model: claude-opus-4",
].join("\n");

const cleanLog = [
  record("aaa0001", [], "chore: dusk init scaffold", ["package.json", "vitest.config.ts", "test/globalSetup.ts"]),
  record("bbb0002", ["aaa0001"], FULL_TRAILERS, ["src/api/notifications/list.ts"]),
].join("\n");

const intent = (over: Partial<Intent> & Pick<Intent, "id">): Intent => ({
  schema_version: 2,
  description: "fixture",
  obligation: "must",
  compose: "all",
  relates_to: [],
  triples: [{ id: "t1", subject: "s", predicate: "p", object: "o", polarity: "positive" }],
  ...over,
});

function fixtureTree(): Map<string, Intent> {
  const entries: Intent[] = [
    intent({ id: "api/notifications/list", triples: [{ id: "neg", subject: "s", predicate: "p", object: "o", polarity: "negative" }] }),
    intent({
      id: "api/notifications/idempotent-write",
      compose: "implies",
      triples: undefined,
      antecedent: [{ id: "a1", subject: "h", predicate: "is decorated with", object: "api/write", polarity: "positive" }],
      consequent: [{ id: "c1", subject: "dup", predicate: "yields", object: "one", polarity: "positive" }],
    }),
    intent({ id: "api/notifications/list/unit-tests" }),
    intent({ id: "api/notifications/list/integration-tests" }),
    intent({ id: "api/notifications/idempotent-write/e2e-tests" }),
  ];
  return new Map(entries.map((i) => [i.id, i]));
}

const cleanDoctor: StaticAnalysisReport = {
  schema_version: 1,
  generated_at: "2026-06-01T00:00:00.000Z",
  mode: "conservative",
  findings: [],
  density_baseline: [],
};

function fixtureInput(): PocEvaluatorInput {
  const intents = fixtureTree();
  const ids = new Set(intents.keys());
  return {
    poc_repo: "notifications-poc",
    window: { initialized_at: "2026-06-01T00:00:00.000Z", evaluated_at: "2026-06-10T00:00:00.000Z" },
    trailerAudit: { commits: parseGitLog(cleanLog), humanActions: [{ kind: "implement-request" }] },
    provenance: { intents, authorTracedIntentIds: ids, finalizeCreatedIntentIds: ids },
    endpointsNotPipelineLanded: 0,
    gateFalsePositiveCount: 0,
    fullPyramidOnLiveInfra: "green",
    staticAnalysis: { conservative: cleanDoctor, strictUnknowns: { ...cleanDoctor, mode: "strict-unknowns" } },
    exploratory: {
      dialog_turn_distribution: { "5": 2, "8": 1 },
      stage3_acceptance_rate: 0.75,
      iteration_distribution: { "1": 3, "2": 1 },
      pause_resume_count: 1,
      intent_granularity: { intent_count: 5, triple_count: 6, mean_triples_per_intent: 1.2 },
      time_to_endpoint: [{ endpoint: "GET /notifications", ms: 120000 }],
      friction_observations: ["author prompt needed clearer pyramid framing"],
      friction_commits: [{ sha: "fff0001", summary: "docs(roles): clarify pyramid framing" }],
    },
  };
}

describe("evaluatePoc — deterministic zero-model PocReport (poc-report)", () => {
  it("runs twice over fixed inputs and yields byte-identical reports", () => {
    const first = evaluatePoc(fixtureInput());
    const second = evaluatePoc(fixtureInput());
    expect(JSON.stringify(second.report)).toBe(JSON.stringify(first.report));
    expect(second.report).toEqual(first.report);
  });

  it("emits a report that parses against PocReportSchema with top-level pass true when all gates pass", () => {
    const { report } = evaluatePoc(fixtureInput());
    expect(() => PocReportSchema.parse(report)).not.toThrow();
    expect(report.gating.pass).toBe(true);
    expect(report.exploratory.gating).toBe(false);
  });

  it("the gating verdict reflects every hard gate (each carries its own pass/fail)", () => {
    const { report } = evaluatePoc(fixtureInput());
    expect(Object.keys(report.gating).sort()).toEqual([
      "endpoints_not_pipeline_landed",
      "full_pyramid_on_live_infra",
      "gate_false_positive_count",
      "handwritten_application_commit_count",
      "intents_not_dialog_authored",
      "pass",
      "static_analysis_both_modes",
    ]);
    expect(report.gating).toMatchObject({
      handwritten_application_commit_count: { value: 0, pass: true },
      endpoints_not_pipeline_landed: { value: 0, pass: true },
      gate_false_positive_count: { value: 0, pass: true },
      intents_not_dialog_authored: { value: 0, pass: true },
      full_pyramid_on_live_infra: { value: "green", pass: true },
      static_analysis_both_modes: { value: "clean", pass: true },
    });
  });

  it("any failing hard gate flips top-level pass to false, and friction data never gates", () => {
    const base = fixtureInput();

    // A handwritten commit (missing trailers, required source) fails the zero-handwritten gate.
    const malformed = record("ccc0003", ["aaa0001"], "feat: hand write\n\nIntent: api/x", ["src/api/x.ts"]);
    const withHandwritten = { ...base, trailerAudit: { commits: parseGitLog([cleanLog, malformed].join("\n")), humanActions: base.trailerAudit.humanActions } };
    const r1 = evaluatePoc(withHandwritten).report;
    expect(r1.gating.handwritten_application_commit_count.pass).toBe(false);
    expect(r1.gating.pass).toBe(false);

    // A red pyramid + eroded static analysis each fail their gate.
    const eroded = evaluatePoc({
      ...base,
      fullPyramidOnLiveInfra: "red",
      staticAnalysis: {
        conservative: { ...cleanDoctor, findings: [{ class: "s_not_subset_d", file: "src/a.ts", line: 1, intents_involved: [], suggestion: "x", severity: "error" }] },
        strictUnknowns: { ...cleanDoctor, mode: "strict-unknowns" },
      },
    }).report;
    expect(eroded.gating.full_pyramid_on_live_infra.pass).toBe(false);
    expect(eroded.gating.static_analysis_both_modes.pass).toBe(false);
    expect(eroded.gating.pass).toBe(false);

    // Changing exploratory data does not move the gating verdict.
    const noisyExploratory = evaluatePoc({ ...base, exploratory: { ...base.exploratory, pause_resume_count: 99, friction_observations: ["different"] } }).report;
    expect(noisyExploratory.gating).toEqual(evaluatePoc(base).report.gating);
  });

  it("an orphaned intent fails the dialog-authored gate via the §5.3 primitive", () => {
    const base = fixtureInput();
    const partial = new Set([...base.provenance.authorTracedIntentIds].filter((id) => id !== "api/notifications/list"));
    const report = evaluatePoc({ ...base, provenance: { ...base.provenance, authorTracedIntentIds: partial } }).report;
    expect(report.gating.intents_not_dialog_authored.value).toBeGreaterThan(0);
    expect(report.gating.intents_not_dialog_authored.pass).toBe(false);
    expect(report.gating.pass).toBe(false);
  });
});
