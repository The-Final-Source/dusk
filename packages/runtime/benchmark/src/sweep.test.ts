import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixedClock } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FixtureVerifierCall } from "./auditRunner.js";
import { assembleBenchmarkReport, agreementMatrix } from "./reportPostPass.js";
import { readSweepRecords, runBenchmarkSweep, type SweepDeps } from "./sweep.js";

// 5.1 + 5.2 — the per-model sweep engine (design D6) + the pure report
// post-passes (P5-T13). Zero-model: the scripted-verdict doubles stand in as
// "models"; the gate/doctor legs are stubbed handlers.

const rejectAll: FixtureVerifierCall = async () => ({
  decision: "reject",
  rationale: "rejected",
  evidence: { focal_claims: [] },
  usage: { latency_ms: 10, cost_usd: 0.001 },
});
const acceptAll: FixtureVerifierCall = async () => ({
  decision: "accept",
  rationale: "accepted",
  evidence: { focal_claims: [] },
  usage: { latency_ms: 20, cost_usd: 0.002 },
});

let outDir: string;
beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "dusk-sweep-"));
});
afterEach(() => rmSync(outDir, { recursive: true, force: true }));

const miniSet = new Set([
  "mechanical/missing-decorator-function",
  "static-analysis/erosion-same-file-call",
  "verification/negative-raw-sql",
  "verification/calibration-good-persist-first",
  "two-stage-test/tautology",
]);

const deps = (over: Partial<SweepDeps> = {}): SweepDeps => ({
  outDir,
  models: [
    { name: "double-reject", call: rejectAll },
    { name: "double-accept", call: acceptAll },
  ],
  gate: () => ({ blocked: true }),
  staticAnalyzer: () => ({ flagged: true }),
  filter: (f) => miniSet.has(f.id),
  clock: fixedClock(1_000),
  ...over,
});

describe("5.1 — sequential per-model sweeps over one stored manifest", () => {
  it("the manifest holds fixtures × models verdicts, sequentially grouped by model", async () => {
    const result = await runBenchmarkSweep(deps());
    expect(result.success).toBe(true);
    if (!result.success) return;

    const records = readSweepRecords(outDir);
    expect(records.length).toBe(miniSet.size * 2);

    // Sequential grouping: model 1's COMPLETE sweep precedes model 2's first verdict.
    const models = records.map((r) => r.model);
    expect(models.slice(0, miniSet.size).every((m) => m === "double-reject")).toBe(true);
    expect(models.slice(miniSet.size).every((m) => m === "double-accept")).toBe(true);

    // Keyed (fixture_id, model) — one verdict per pair.
    const keys = new Set(records.map((r) => `${r.fixture_id} ${r.model}`));
    expect(keys.size).toBe(records.length);
  });

  it("each class routes to its designed layer in the manifest", async () => {
    await runBenchmarkSweep(deps());
    const records = readSweepRecords(outDir);
    const layerOf = (id: string): string[] => [...new Set(records.filter((r) => r.fixture_id === id).map((r) => r.layer))];
    expect(layerOf("mechanical/missing-decorator-function")).toEqual(["gate"]);
    expect(layerOf("static-analysis/erosion-same-file-call")).toEqual(["doctor"]);
    expect(layerOf("verification/negative-raw-sql")).toEqual(["verifier"]);
    expect(layerOf("two-stage-test/tautology")).toEqual(["verifier-test-prepass"]);
  });
});

describe("5.2 — every report section derives from the one stored manifest (P5-T13)", () => {
  it("the report carries per-model per-class accuracy, latency/cost, and the agreement matrix; it parses against the schema", async () => {
    await runBenchmarkSweep(deps());
    const records = readSweepRecords(outDir);
    const report = assembleBenchmarkReport({ runId: "bench_test", records, models: ["double-reject", "double-accept"], clock: fixedClock(2_000) });

    const rejectClasses = report.per_model_per_class_accuracy.find((m) => m.model === "double-reject")!.classes;
    expect(rejectClasses.find((c) => c.class === "verification")!.accuracy).toBe(0.5); // catches the bad one, wrongly rejects the good one
    expect(rejectClasses.find((c) => c.class === "two-stage-test")!.accuracy).toBe(1);
    expect(rejectClasses.find((c) => c.class === "mechanical")!.accuracy).toBe(1);

    const acceptClasses = report.per_model_per_class_accuracy.find((m) => m.model === "double-accept")!.classes;
    expect(acceptClasses.find((c) => c.class === "verification")!.accuracy).toBe(0.5); // accepts the good one, misses the bad one

    expect(report.per_role_per_model.find((r) => r.role === "verifier" && r.model === "double-reject")).toMatchObject({ mean_latency_ms: 10 });
    expect(report.agreement_matrix.models).toEqual(["double-reject", "double-accept"]);
    // The doubles disagree on every shared verifier verdict.
    expect(report.agreement_matrix.rates[0][1]).toBe(0);
    expect(report.agreement_matrix.rates[0][0]).toBe(1);
  });

  it("the agreement matrix recomputed from the stored manifest is identical and makes zero model calls", async () => {
    await runBenchmarkSweep(deps());
    vi.stubGlobal("fetch", () => {
      throw new Error("the post-pass must never reach a model");
    });
    try {
      const records = readSweepRecords(outDir);
      const first = agreementMatrix(records, ["double-reject", "double-accept"]);
      const second = agreementMatrix(readSweepRecords(outDir), ["double-reject", "double-accept"]);
      expect(second).toEqual(first);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
