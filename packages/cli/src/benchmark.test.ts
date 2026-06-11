import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BenchmarkReportSchema } from "@dusk/core-schema";
import type { SweepModel } from "@dusk/runtime-benchmark";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runBenchmarkCli } from "./benchmark.js";

// 8.1 / 8.3 — `dusk benchmark` at the CLI boundary (zero-model via the
// double-backed sweep + the refusal paths) and --help.

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

// A "perfect" double model: produces the ground-truth outcome for every fixture.
const perfectModel = (name: string): SweepModel => ({
  name,
  call: async (fixture) => ({
    decision: fixture.ground_truth_outcome === "verifier_accept" ? "accept" : "reject",
    rationale: `scripted verdict for ${fixture.id}`,
    evidence: { focal_claims: [] },
    usage: { latency_ms: 5, cost_usd: 0 },
  }),
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dusk-bench-cli-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("dusk benchmark runs the harness and writes the report", () => {
  it("writes verdicts.jsonl + benchmark-report.json under the run dir and exits 0 with a human summary", async () => {
    const result = await runBenchmarkCli(root, [], {
      clock: { now: () => 1_750_000_000_000 },
      sweepModels: [perfectModel("double-a"), perfectModel("double-b")],
    });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("mechanical");
    expect(result.text).toContain("100%");

    const runsDir = join(root, ".ia/observability/benchmark-runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    expect(existsSync(join(runDir, "verdicts.jsonl"))).toBe(true);
    const report = BenchmarkReportSchema.parse(JSON.parse(readFileSync(join(runDir, "benchmark-report.json"), "utf8")));
    expect(report.models).toEqual(["double-a", "double-b"]);
    expect(report.fixture_count).toBe(60);
    // The real gate caught the whole mechanical class through the sweep.
    for (const m of report.per_model_per_class_accuracy) {
      expect(m.classes.find((c) => c.class === "mechanical")).toMatchObject({ total: 14, caught: 14, accuracy: 1 });
      expect(m.classes.find((c) => c.class === "static-analysis")).toMatchObject({ total: 10, caught: 10, accuracy: 1 });
    }
  }, 120_000);
});

describe("--audit-verifier-freshness enforces pre-registration at the CLI", () => {
  it("prints the typed refusal and returns non-ok when audit-thresholds.json is absent", async () => {
    const result = await runBenchmarkCli(root, ["--audit-verifier-freshness"], {
      thresholdsPath: join(root, "audit-thresholds.json"),
      modelClientFor: () => {
        throw new Error("the refusal must fire before any model client is built");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("config_invalid");
    expect(result.text).toContain("refuses to score");
  });
});

describe("every new command and flag supports --help (8.3)", () => {
  const helpOf = (args: string[]): { code: number; out: string } => {
    const out = execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
    return { code: 0, out };
  };

  it("dusk benchmark --help exits 0 with usage and an example", () => {
    const { out } = helpOf(["benchmark", "--help"]);
    expect(out).toContain("dusk benchmark");
    expect(out).toContain("--audit-verifier-freshness");
    expect(out).toContain("--calibrate-audit");
    expect(out).toContain("--evaluate-dogfood");
    expect(out).toContain("Example:");
  });

  it("dusk doctor --static-analysis --help exits 0 with usage and an example", () => {
    const { out } = helpOf(["doctor", "--static-analysis", "--help"]);
    expect(out).toContain("--static-analysis");
    expect(out).toContain("--strict-unknowns");
    expect(out).toContain("Example: dusk doctor --static-analysis");
  });
});
