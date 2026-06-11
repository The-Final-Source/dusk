import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BenchmarkReport, DuskError } from "@dusk/core-schema";
import { runGate, type HookInput } from "@dusk/pre-tool-use";
import { analyzeStaticDecoration, buildDerivedIndex } from "@dusk/core-index";
import { parseDecorations } from "@dusk/core-decoration";
import { loadIntentTree } from "@dusk/core-graph";
import { claudeCodeModelClient, type ModelClient } from "@dusk/runtime-verifier";
import {
  assembleBenchmarkReport,
  calibrateAudit,
  evaluateDogfood,
  materializeFixtureProject,
  realFixtureVerifierCall,
  runBenchmarkSweep,
  runFreshnessAudit,
  type Clock,
  type SeededFixture,
  type SweepModel,
} from "@dusk/runtime-benchmark";

/**
 * `dusk benchmark` — the Phase-5 measurement surface (8.1). Sub-modes:
 *   (default)                  per-model sweep over the seeded fixture → BenchmarkReport
 *   --models <m1,m2,…>         models for the sweep (default claude-sonnet-4-6)
 *   --calibrate-audit          calibrate + freeze audit-thresholds.json (calibration split ONLY)
 *   --audit-verifier-freshness the standing three-axis audit (refuses without frozen bars)
 *   --evaluate-dogfood         the deterministic go/no-go evaluation over the window data
 * Exit codes: 0 on success/report; non-zero on typed errors (incl. the
 * pre-registration refusals surfaced at the CLI boundary).
 */

export const BENCHMARK_HELP = `dusk benchmark [--models <m1,m2,…>] [--calibrate-audit | --audit-verifier-freshness | --evaluate-dogfood]
  Run the seeded-violations benchmark harness (RFC §7.3–§7.5). Default: one
  complete fixture sweep per model, sequentially; every verdict stored in
  .ia/observability/benchmark-runs/<run-id>/verdicts.jsonl; the BenchmarkReport
  (per-model per-class accuracy, per-role latency/cost, cross-model agreement
  matrix) is a pure post-pass over that one manifest.
  Flags:
    --models <list>             comma-separated model ids (default claude-sonnet-4-6)
    --calibrate-audit           run the calibration split ONLY and write the frozen
                                audit-thresholds.json with provenance (re-runnable;
                                forbidden only AFTER scoring test data)
    --audit-verifier-freshness  the standing three-axis fresh-Verifier audit at N≥10
                                (verdict entropy + rationale overlap + structural
                                citation precision — no LLM-judge); REFUSES without
                                pre-registered frozen thresholds
    --evaluate-dogfood          deterministic go/no-go evaluation of the dogfood
                                window (gating = the four named thresholds only)
  Example: dusk benchmark --models claude-sonnet-4-6
  Example: dusk benchmark --calibrate-audit
  Example: dusk benchmark --audit-verifier-freshness
  Example: dusk benchmark --evaluate-dogfood
`;

export type BenchmarkCliDeps = {
  clock?: Clock;
  /** Injectable model factory (tests substitute the scripted double). */
  modelClientFor?: (model: string) => ModelClient;
  /** Injectable sweep models (tests substitute doubles standing in as models). */
  sweepModels?: SweepModel[];
  thresholdsPath?: string;
  fixtureRoot?: string;
};

const errText = (prefix: string, error: DuskError): string => `${prefix}: ${error.kind} — ${error.message}\n`;

function gateLeg(fixture: SeededFixture): { blocked: boolean } {
  // The REAL mechanical gate over the fixture's materialized mini-project.
  const dir = mkdtempSync(join(tmpdir(), "dusk-bench-gate-"));
  try {
    materializeFixtureProject(fixture, dir);
    const file = fixture.ground_truth_defect_loc?.file ?? fixture.files.find((f) => !f.startsWith("intents/"))!;
    const input: HookInput = { tool: "Write", args: { file_path: join(dir, file), content: readFixtureFile(fixture, file) } };
    return { blocked: runGate(input).decision === "block" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const readFixtureFile = (fixture: SeededFixture, rel: string): string => readFileSync(join(fixture.dir, rel), "utf8");

function staticLeg(fixture: SeededFixture): { flagged: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "dusk-bench-static-"));
  try {
    materializeFixtureProject(fixture, dir);
    const files: Record<string, string> = {};
    for (const rel of fixture.files) {
      if (rel.startsWith("intents/")) continue;
      files[rel] = readFixtureFile(fixture, rel);
    }
    const tree = loadIntentTree(join(dir, ".ia/intents"));
    const records = Object.entries(files).flatMap(([file, source]) => parseDecorations(source, file));
    const index = buildDerivedIndex(records, tree.intents);
    const { findings } = analyzeStaticDecoration({ files, index, mode: "conservative" });
    const loc = fixture.ground_truth_defect_loc;
    return { flagged: findings.some((f) => f.class === "s_not_subset_d" && (!loc || (f.file === loc.file && f.line === loc.line))) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function renderBenchmarkSummary(report: BenchmarkReport): string {
  const lines: string[] = [`benchmark ${report.run_id} — ${report.fixture_count} fixtures, models: ${report.models.join(", ")}`];
  for (const entry of report.per_model_per_class_accuracy) {
    for (const cls of entry.classes) {
      lines.push(`  ${entry.model}  ${cls.class.padEnd(16)} ${cls.caught}/${cls.total}  (${(cls.accuracy * 100).toFixed(0)}%)`);
    }
  }
  lines.push(`  agreement: ${report.agreement_matrix.models.join(" × ")} → ${JSON.stringify(report.agreement_matrix.rates)}`);
  return `${lines.join("\n")}\n`;
}

export async function runBenchmarkCli(root: string, args: string[], deps: BenchmarkCliDeps = {}): Promise<{ ok: boolean; text: string }> {
  const clock: Clock = deps.clock ?? { now: () => Date.now() };
  const modelClientFor = deps.modelClientFor ?? ((model: string) => claudeCodeModelClient({ model }));

  if (args.includes("--evaluate-dogfood")) {
    const result = evaluateDogfood({ root, clock });
    if (!result.success) return { ok: false, text: errText("benchmark --evaluate-dogfood", result.error) };
    const report = result.value;
    const outDir = join(root, ".ia/observability/dogfood");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "dogfood-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const g = report.gating;
    const lines = [
      `dogfood ${report.package} — day ${report.window.days} of the window`,
      `  [${g.e2e_implement_success_count.pass ? "PASS" : "FAIL"}] e2e_implement_success_count ${g.e2e_implement_success_count.value} (${g.e2e_implement_success_count.threshold})`,
      `  [${g.gate_false_positive_count.pass ? "PASS" : "FAIL"}] gate_false_positive_count ${g.gate_false_positive_count.value} (${g.gate_false_positive_count.threshold})`,
      `  [${g.worked_example_regression.pass ? "PASS" : "FAIL"}] worked_example_regression ${g.worked_example_regression.value}`,
      `  [${g.package_test_suite.pass ? "PASS" : "FAIL"}] package_test_suite ${g.package_test_suite.value}`,
      `  go/no-go: ${g.pass ? "GO" : "NO-GO"}  (exploratory metrics: see dogfood-report.json — gating: false)`,
    ];
    return { ok: true, text: `${lines.join("\n")}\n` };
  }

  if (args.includes("--calibrate-audit")) {
    const workDir = mkdtempSync(join(tmpdir(), "dusk-calibrate-"));
    try {
      const model = (flagValue(args, "--models") ?? "claude-sonnet-4-6").split(",")[0];
      const call = realFixtureVerifierCall({ workDir, modelClient: modelClientFor(model) });
      const result = await calibrateAudit({ thresholdsPath: deps.thresholdsPath, root: deps.fixtureRoot, call, clock });
      if (!result.success) return { ok: false, text: errText("benchmark --calibrate-audit", result.error) };
      return {
        ok: true,
        text: `calibrated + froze audit thresholds over ${result.value.calibration_fixture_ids.length} calibration fixtures (calibrated_at ${result.value.calibrated_at})\n`,
      };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  if (args.includes("--audit-verifier-freshness")) {
    const workDir = mkdtempSync(join(tmpdir(), "dusk-audit-"));
    try {
      const model = (flagValue(args, "--models") ?? "claude-sonnet-4-6").split(",")[0];
      // Lazy client construction: the pre-registration refusals fire BEFORE
      // anything model-shaped exists (design D1).
      let realCall: ReturnType<typeof realFixtureVerifierCall> | undefined;
      const call: ReturnType<typeof realFixtureVerifierCall> = (fixture, i, variant) => {
        realCall ??= realFixtureVerifierCall({ workDir, modelClient: modelClientFor(model) });
        return realCall(fixture, i, variant);
      };
      const result = await runFreshnessAudit({ thresholdsPath: deps.thresholdsPath, root: deps.fixtureRoot, call, clock });
      if (!result.success) return { ok: false, text: errText("benchmark --audit-verifier-freshness", result.error) };
      const report = result.value;
      const outDir = join(root, ".ia/observability/benchmark-runs", report.run_id);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "audit-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      const s = report.curated.scores;
      const lines = [
        `audit ${report.run_id} — N=${report.n_per_fixture} over ${report.curated.fixtures.length} known-bad fixtures`,
        `  [${s.axis1_variance.pass ? "PASS" : "FAIL"}] axis1 variance (mean entropy ${s.axis1_variance.mean_entropy_known_bad.toFixed(3)})`,
        `  [${s.axis2_similarity.pass ? "PASS" : "FAIL"}] axis2 similarity (mean overlap ${s.axis2_similarity.mean_token_overlap.toFixed(3)})`,
        `  [${s.axis3_citation.pass ? "PASS" : "FAIL"}] axis3 citation (aligned-4of5 ${(s.axis3_citation.pct_fixtures_aligned_4of5 * 100).toFixed(0)}%, all-unaligned ${(s.axis3_citation.pct_fixtures_all_unaligned * 100).toFixed(0)}%)`,
        ...report.quadrant_flags.map((q) => `  variant ${q.variant}: ${q.rubber_stamp_quadrant ? "RUBBER-STAMP QUADRANT" : "ok"}${q.no_citation_flag ? " (no citations)" : ""}`),
      ];
      return { ok: true, text: `${lines.join("\n")}\n` };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  // Default: the per-model sweep + report post-passes.
  const models = (flagValue(args, "--models") ?? "claude-sonnet-4-6").split(",").map((m) => m.trim()).filter(Boolean);
  const runId = `bench_${new Date(clock.now()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const outDir = join(root, ".ia/observability/benchmark-runs", runId);
  const workDir = mkdtempSync(join(tmpdir(), "dusk-bench-"));
  try {
    const sweepModels: SweepModel[] =
      deps.sweepModels ?? models.map((name) => ({ name, call: realFixtureVerifierCall({ workDir: join(workDir, name), modelClient: modelClientFor(name) }) }));
    const sweep = await runBenchmarkSweep({ root: deps.fixtureRoot, outDir, models: sweepModels, gate: gateLeg, staticAnalyzer: staticLeg, clock });
    if (!sweep.success) return { ok: false, text: errText("benchmark", sweep.error) };
    const report = assembleBenchmarkReport({ runId, records: sweep.value.records, models: sweepModels.map((m) => m.name), clock });
    writeFileSync(join(outDir, "benchmark-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return { ok: true, text: renderBenchmarkSummary(report) };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}
