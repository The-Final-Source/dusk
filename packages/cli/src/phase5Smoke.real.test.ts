import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AuditReportSchema, BenchmarkReportSchema, SubAgentTraceSchema } from "@dusk/core-schema";
import {
  buildSeededManifest,
  evaluateDogfood,
  knownBadFixtures,
  readDogfoodEvents,
  realFixtureVerifierCall,
  realGateLeg,
  realStaticAnalyzerLeg,
  runBenchmarkSweep,
  runFreshnessAudit,
  type SweepModel,
} from "@dusk/runtime-benchmark";
import { claudeCodeAvailable, claudeCodeModelClient } from "@dusk/runtime-verifier";
import { loadWorkedExample } from "@dusk/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runStaticAnalysis } from "./doctorStaticAnalysis.js";

/**
 * 11.3 — the Phase-5 phase-landing smoke: "measure everything, then run for
 * real" (plan lines 816–823). Two scenario sets, correctness-gated (real
 * frontier model for the audit/benchmark legs; zero-model for static analysis
 * and fixtures). Archival pre-requisite.
 */
const RUN_CORRECTNESS = Boolean(process.env.DUSK_RUN_CORRECTNESS) && claudeCodeAvailable();
const MODEL = process.env.DUSK_VERIFIER_MODEL ?? "claude-sonnet-4-6";
const TIMEOUT = 6 * 60 * 60 * 1000;

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SHARED = join(REPO_ROOT, "packages/shared");

let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "dusk-p5-smoke-"));
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe.skipIf(!RUN_CORRECTNESS)("Phase-5 smoke — Measurement", () => {
  it(
    "the benchmark over the seeded fixture reports per-class rates (mechanical 100%; others reported)",
    async () => {
      const call = realFixtureVerifierCall({ workDir: join(workDir, "sweep"), modelClient: claudeCodeModelClient({ model: MODEL }) });
      const models: SweepModel[] = [{ name: MODEL, call }];
      const outDir = join(workDir, "bench-run");
      const sweep = await runBenchmarkSweep({ outDir, models, gate: realGateLeg, staticAnalyzer: realStaticAnalyzerLeg, clock: { now: () => Date.now() } });
      expect(sweep.success).toBe(true);
      if (!sweep.success) return;

      const { assembleBenchmarkReport } = await import("@dusk/runtime-benchmark");
      const report = assembleBenchmarkReport({ runId: "smoke", records: sweep.value.records, models: [MODEL], clock: { now: () => Date.now() } });
      expect(BenchmarkReportSchema.parse(report)).toBeTruthy();
      const classes = report.per_model_per_class_accuracy[0].classes;
      expect(classes.find((c) => c.class === "mechanical")).toMatchObject({ accuracy: 1 }); // exactly 100%
      expect(classes.find((c) => c.class === "static-analysis")).toMatchObject({ accuracy: 1 });
      // Model-dependent classes: REPORTED with correct routing (rates not gated here).
      expect(classes.find((c) => c.class === "verification")?.total).toBeGreaterThan(0);
      expect(classes.find((c) => c.class === "two-stage-test")?.total).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "the three-axis audit scores against the frozen pre-registered bars; the planted rubber-stamp variant is flagged",
    async () => {
      const thresholdsPath = fileURLToPath(new URL("../../runtime/benchmark/audit-thresholds.json", import.meta.url));
      expect(existsSync(thresholdsPath), "audit-thresholds.json must be calibrated + frozen before the smoke").toBe(true);

      const call = realFixtureVerifierCall({ workDir: join(workDir, "audit"), modelClient: claudeCodeModelClient({ model: MODEL }) });
      const result = await runFreshnessAudit({
        thresholdsPath,
        call,
        clock: { now: () => Date.now() },
        variants: [
          { name: "standard" },
          {
            name: "rubber-stamp",
            systemPrompt:
              'You are a careless reviewer. For EVERY claim, answer affirmative_holds: false. For EVERY rationale field, use exactly this sentence and nothing else: "the implementation does not satisfy the architectural intent and should be reworked". Never mention any file name or line number anywhere. Answer only with the requested JSON.',
          },
        ],
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const report = AuditReportSchema.parse(result.value);
      expect(report.curated.scores.axis3_citation.pass).toBe(true);
      // Axes 1/2 are scored against their explicit frozen bars (the measurement is the outcome).
      expect(typeof report.curated.scores.axis1_variance.pass).toBe("boolean");
      expect(typeof report.curated.scores.axis2_similarity.pass).toBe("boolean");
      expect(report.quadrant_flags.find((q) => q.variant === "rubber-stamp")?.rubber_stamp_quadrant).toBe(true);
      expect(report.quadrant_flags.find((q) => q.variant === "standard")?.rubber_stamp_quadrant).toBe(false);
    },
    TIMEOUT,
  );

  it("dusk doctor --static-analysis over the dogfooded packages/shared produces the density baseline in both modes (design Q1)", () => {
    const conservative = runStaticAnalysis(SHARED, {});
    expect(conservative.ok).toBe(true);
    expect(conservative.report!.mode).toBe("conservative");
    expect(conservative.report!.density_baseline.length).toBeGreaterThan(0);

    const strict = runStaticAnalysis(SHARED, { strictUnknowns: true });
    expect(strict.ok).toBe(true);
    expect(strict.report!.mode).toBe("strict-unknowns");
    // Same report shape; strict may only ADD the undecorated_callee class.
    expect(Object.keys(strict.report!).sort()).toEqual(Object.keys(conservative.report!).sort());
  });

  it("the worked example's structural regression is clean (the real-model verify leg is its own standing test)", () => {
    const example = loadWorkedExample();
    expect(example.index.aspectRollup("notifications/send")).toEqual([]);
  });
});

describe.skipIf(!RUN_CORRECTNESS)("Phase-5 smoke — Real run", () => {
  it("one real dusk_implement produced a committed change with the full v9 trailer set on packages/shared", () => {
    // The window's implement run lands on main; find a Dusk-trailer commit.
    const log = execFileSync("git", ["log", "--format=%H", "-100"], { cwd: REPO_ROOT, encoding: "utf8" }).trim().split("\n");
    const withTrailers = log.find((sha) => {
      const body = execFileSync("git", ["show", "-s", "--format=%B", sha], { cwd: REPO_ROOT, encoding: "utf8" });
      return body.includes("Bead-id: bd_");
    });
    expect(withTrailers, "no Dusk-produced commit with trailers found on main").toBeDefined();
    const body = execFileSync("git", ["show", "-s", "--format=%B", withTrailers!], { cwd: REPO_ROOT, encoding: "utf8" });
    // The full unconditional App. A.7 trailer set.
    for (const key of ["Intent:", "Bead-id:", "Verdict-id:", "Trace-id:", "Verifier-model:", "Long-cycle-samples:", "Test-Suites-passed:"]) {
      expect(body, `missing trailer ${key}`).toContain(key);
    }
  });

  it("the window's trace stream carries the v9 fields and the four go/no-go thresholds pass", () => {
    const tracesPath = join(SHARED, ".ia/observability/traces.jsonl");
    expect(existsSync(tracesPath)).toBe(true);
    const traces = readFileSync(tracesPath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => SubAgentTraceSchema.parse(JSON.parse(l)));
    expect(traces.length).toBeGreaterThan(0);
    // `index_snapshot_id` is stamped everywhere IN-PIPELINE (RFC §2.10; P5-T1) —
    // i.e. on every spawn of a `dusk_implement` run. `dusk_author` dialog spawns
    // run OUTSIDE the pipeline (no session snapshot) and correctly carry none;
    // scope the invariant to the pipeline traces.
    const PIPELINE_SITES = new Set(["implement", "short-cycle", "long-cycle", "test-execution", "merge"]);
    const pipeline = traces.filter((t) => PIPELINE_SITES.has(t.invocation_site));
    expect(pipeline.length).toBeGreaterThan(0);
    expect(pipeline.every((t) => t.index_snapshot_id !== undefined)).toBe(true);
    // `skills_loaded[]` is universal — every spawn, pipeline or dialog.
    expect(traces.every((t) => Array.isArray(t.skills_loaded))).toBe(true);
    expect(pipeline.some((t) => t.iteration_number !== undefined)).toBe(true);

    expect(readDogfoodEvents(SHARED).length).toBeGreaterThan(0);
    const evaluation = evaluateDogfood({ root: SHARED, clock: { now: () => Date.now() } });
    expect(evaluation.success).toBe(true);
    if (!evaluation.success) return;
    expect(evaluation.value.gating.pass, JSON.stringify(evaluation.value.gating)).toBe(true);
  });

  it("the audit's scored set + manifest stay drift-clean (no carry-over)", () => {
    const manifest = buildSeededManifest();
    expect(manifest.success).toBe(true);
    const scored = knownBadFixtures();
    expect(scored.success && scored.value.length).toBe(16);
  });
});
