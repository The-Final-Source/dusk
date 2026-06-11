import { FlakeCharacterizationSchema } from "@dusk/core-schema";
import { describe, expect, it } from "vitest";

import type { FixtureVerifierCall } from "./auditRunner.js";
import { characterizeFlakeRate } from "./flake.js";

// 5.3 (mechanics) — the P5-T8 flake-rate characterization is REPORT-ONLY. The
// zero-model mechanics are driven by a scripted call; the real-model leg is
// correctness-gated in flake.real.test.ts. No suite anywhere consumes the rate
// VALUES as a gate — the artifact's `gating: false` literal enforces that
// structurally.

describe("the flake-rate characterization produces a report with tolerance bands", () => {
  it("records first-call rejects and confirmation dismissals without gating on either", async () => {
    // Scripted: every 5th first call rejects; confirmations always accept (dismissed).
    let calls = 0;
    const scripted: FixtureVerifierCall = async () => {
      calls += 1;
      const isFirstCallReject = calls % 5 === 0 && calls % 15 !== 0;
      return { decision: isFirstCallReject ? "reject" : "accept", rationale: "scripted", evidence: { focal_claims: [] } };
    };

    const result = await characterizeFlakeRate({ n: 10, call: scripted });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const report = result.value;

    // Shape + completeness only — never a specific rate value.
    expect(FlakeCharacterizationSchema.parse(report)).toEqual(report);
    expect(report.gating).toBe(false);
    expect(report.n_first_calls).toBe(40); // 4 clean fixtures × n=10
    expect(report.first_call_reject_rate).toBeGreaterThanOrEqual(0);
    expect(report.first_call_reject_rate).toBeLessThanOrEqual(1);
    const [lo, hi] = report.tolerance_bands.first_call_reject;
    expect(lo).toBeLessThanOrEqual(report.first_call_reject_rate);
    expect(hi).toBeGreaterThanOrEqual(report.first_call_reject_rate);
  });
});
