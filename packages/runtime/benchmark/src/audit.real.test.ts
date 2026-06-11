import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuditThresholdsSchema } from "@dusk/core-schema";
import { claudeCodeAvailable, claudeCodeModelClient } from "@dusk/runtime-verifier";
import { systemClock } from "@dusk/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runFreshnessAudit } from "./auditRunner.js";
import { buildSeededManifest } from "./fixtureManifest.js";
import { calibrateAudit } from "./calibrate.js";
import { realFixtureVerifierCall } from "./realAuditCall.js";

/**
 * 4.2 / 4.4 / 4.5 — the calibration + standing three-axis audit against the
 * REAL frontier model at temperature 0 (ambient Claude Code CLI, no API key).
 * Correctness-gated per the Phase 2–4 convention. The audit's own statistical
 * protocol applies (pre-registered frozen bars, N≥10) — it supersedes the
 * N=3 ≥2/3 convention for this surface. Every model call is wrapped in the
 * pre-registered transport-failure protocol (realFixtureVerifierCall).
 *
 * This is the most expensive test surface in v1 (≈400 model calls): nightly /
 * on-demand only, never per-PR.
 */
const RUN_CORRECTNESS = Boolean(process.env.DUSK_RUN_CORRECTNESS) && claudeCodeAvailable();
const MODEL = process.env.DUSK_VERIFIER_MODEL ?? "claude-sonnet-4-6";
const N = 10;
const TIMEOUT = 4 * 60 * 60 * 1000;

// The planted rubber-stamping Verifier (P5-T3/T5 plant): always-reject with a
// fixed generic rationale and NO file:line citation — the High-similarity ×
// Low-precision signature the audit must flag.
const RUBBER_STAMP_PROMPT =
  "You are a careless reviewer. For EVERY claim, answer affirmative_holds: false. For EVERY rationale field, " +
  'use exactly this sentence and nothing else: "the implementation does not satisfy the architectural intent and should be reworked". ' +
  "Never mention any file name or line number anywhere. Answer only with the requested JSON.";

let workDir: string;
let thresholdsPath: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "dusk-audit-real-"));
  thresholdsPath = join(workDir, "audit-thresholds.json");
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe.skipIf(!RUN_CORRECTNESS)("the fresh-Verifier audit against the real frontier model (N≥10)", () => {
  it(
    "4.2 — calibration over the manifest-declared split writes a schema-valid frozen file naming exactly that split",
    async () => {
      const call = realFixtureVerifierCall({ workDir: join(workDir, "calibrate"), modelClient: claudeCodeModelClient({ model: MODEL }) });
      const result = await calibrateAudit({ thresholdsPath, n: N, call, clock: systemClock });
      expect(result.success).toBe(true);
      if (!result.success) return;

      const onDisk = AuditThresholdsSchema.parse(JSON.parse(readFileSync(thresholdsPath, "utf8")));
      expect(onDisk.frozen).toBe(true);
      expect(onDisk.calibrated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const manifest = buildSeededManifest();
      expect(manifest.success).toBe(true);
      if (!manifest.success) return;
      expect([...onDisk.calibration_fixture_ids].sort()).toEqual([...manifest.value.calibration_fixture_ids].sort());
      expect(onDisk.confidence_intervals).toBeDefined();
    },
    TIMEOUT,
  );

  it(
    "4.4 + 4.5 — the standing audit meets the pre-registered bars; the planted rubber-stamp variant is flagged; a no-citation Verifier is flagged",
    async () => {
      const call = realFixtureVerifierCall({ workDir: join(workDir, "audit"), modelClient: claudeCodeModelClient({ model: MODEL }) });
      const result = await runFreshnessAudit({
        thresholdsPath,
        n: N,
        call,
        clock: systemClock,
        variants: [{ name: "standard" }, { name: "rubber-stamp", systemPrompt: RUBBER_STAMP_PROMPT }],
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const report = result.value;

      // N≥10 over the full known-bad set, scored against the frozen bars.
      expect(report.n_per_fixture).toBeGreaterThanOrEqual(10);
      expect(report.curated.fixtures.length).toBe(16);

      // Axis 3 meets the pre-registered citation bar (≥80% fixtures ≥4/5 aligned; ≤5% all-unaligned).
      expect(report.curated.scores.axis3_citation.pass).toBe(true);
      // Axes 1 and 2 are scored against their explicit numeric bars — not narrative judgment.
      expect(report.curated.scores.axis1_variance.pass).toBe(true);
      expect(report.curated.scores.axis2_similarity.pass).toBe(true);

      // The planted rubber-stamping variant lands in the High-similarity ×
      // Low-precision quadrant per the §7.5.1 table; the standard variant does not.
      const standard = report.quadrant_flags.find((f) => f.variant === "standard")!;
      const planted = report.quadrant_flags.find((f) => f.variant === "rubber-stamp")!;
      expect(standard.rubber_stamp_quadrant).toBe(false);
      expect(planted.rubber_stamp_quadrant).toBe(true);

      // The no-citation condition is flagged explicitly, never silently degraded.
      expect(planted.no_citation_flag).toBe(true);
    },
    TIMEOUT,
  );
});
