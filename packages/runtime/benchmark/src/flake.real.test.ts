import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FlakeCharacterizationSchema } from "@dusk/core-schema";
import { claudeCodeAvailable, claudeCodeModelClient } from "@dusk/runtime-verifier";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterizeFlakeRate } from "./flake.js";
import { realFixtureVerifierCall } from "./realAuditCall.js";

/**
 * 5.3 — P5-T8: the real-model confirmation-pass flake-rate characterization.
 * Correctness-gated; transport amendment applied inside realFixtureVerifierCall.
 * The test asserts the report's SHAPE and completeness only — no specific rate
 * is asserted, and nothing gates on the values (report-only by construction).
 */
const RUN_CORRECTNESS = Boolean(process.env.DUSK_RUN_CORRECTNESS) && claudeCodeAvailable();
const MODEL = process.env.DUSK_VERIFIER_MODEL ?? "claude-sonnet-4-6";
const TIMEOUT = 2 * 60 * 60 * 1000;

let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "dusk-flake-real-"));
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe.skipIf(!RUN_CORRECTNESS)("P5-T8 — flake-rate characterization against the real model (report-only)", () => {
  it(
    "produces the report with observed rates and tolerance bands; no rate value is asserted",
    async () => {
      const call = realFixtureVerifierCall({ workDir, modelClient: claudeCodeModelClient({ model: MODEL }) });
      const result = await characterizeFlakeRate({ n: 10, call });
      expect(result.success).toBe(true);
      if (!result.success) return;

      const report = result.value;
      expect(FlakeCharacterizationSchema.parse(report)).toEqual(report);
      expect(report.gating).toBe(false);
      expect(report.n_first_calls).toBeGreaterThanOrEqual(40); // high-N: ≥10 per clean fixture
      expect(report.tolerance_bands.first_call_reject).toHaveLength(2);
      expect(report.tolerance_bands.confirmation_dismissal).toHaveLength(2);
    },
    TIMEOUT,
  );
});
