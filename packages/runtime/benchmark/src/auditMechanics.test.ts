import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixedClock } from "@dusk/test-harness";
import type { SubAgentTrace } from "@dusk/core-schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { shannonEntropy } from "./auditAxes.js";
import { runFreshnessAudit, type FixtureVerifierCall } from "./auditRunner.js";
import { KNOWN_BAD_DISSENT_FRACTION } from "./calibrate.js";
import { frozenThresholds } from "./testSupport.js";
import { assembleOrganicCohort } from "./organicCohort.js";

// 4.4 (mechanics) + 4.6 — the audit runner's deterministic mechanics driven by
// scripted calls (zero-model), and the bias-annotated organic cohort (P5-T4).

// v1.x — the Axis-1 known-bad variance tolerance is N-derived and meaningful
// (not the razor-thin known-good-anchored floor that failed on one borderline
// dissent). Locked zero-model so a regression in the derivation is caught
// without the real model.
describe("Axis-1 known-bad dissent tolerance (v1.x calibration fix)", () => {
  it("tolerates a small borderline-dissent fraction at N=10 (~0.117 bit), well above one fixture's single flip", () => {
    const barAtN = (n: number) => KNOWN_BAD_DISSENT_FRACTION * shannonEntropy([n - 1, 1]);
    const bar = barAtN(10);
    expect(bar).toBeCloseTo(0.117, 3);
    // A reliable verifier that flips a single verdict on one borderline fixture
    // (out of 16) sits far under the bar — it must NOT be read as unreliability.
    const oneBorderlineFlipMean = shannonEntropy([9, 1]) / 16;
    expect(oneBorderlineFlipMean).toBeLessThan(bar);
    // A verifier dissenting once on EVERY known-bad fixture is unreliable → over bar.
    expect(shannonEntropy([9, 1])).toBeGreaterThan(bar);
  });
});

let tmp: string;
let thresholdsPath: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "dusk-audit-mech-"));
  thresholdsPath = join(tmp, "audit-thresholds.json");
  writeFileSync(thresholdsPath, JSON.stringify(frozenThresholds()), "utf8");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

// A precise scripted Verifier: always rejects, citing the exact seeded line.
const preciseCall: FixtureVerifierCall = async (fixture, callIndex) => {
  const loc = fixture.ground_truth_defect_loc!;
  return {
    decision: "reject",
    rationale: `call ${callIndex}: the defect is at ${loc.file}:${loc.line} — the claimed behavior is absent`,
    evidence: { focal_claims: [{ file: loc.file, lines: [loc.line, loc.line] }] },
  };
};

// A rubber-stamping Verifier: always rejects with the SAME generic prose, no citation.
const rubberStampCall: FixtureVerifierCall = async () => ({
  decision: "reject",
  rationale: "the implementation does not satisfy the architectural intent and should be reworked",
  evidence: { focal_claims: [] },
});

const trace = (over: Partial<SubAgentTrace>): SubAgentTrace => ({
  schema_version: 1,
  trace_id: "tr_x",
  role: "verifier",
  invocation_site: "long-cycle",
  model: "test",
  prompt_tokens: 0,
  completion_tokens: 0,
  latency_ms: 0,
  cost_usd: 0,
  ...over,
});

describe("the audit runner's deterministic mechanics (zero-model)", () => {
  it("a precise Verifier passes all three axes; N is clamped to ≥10", async () => {
    const result = await runFreshnessAudit({ thresholdsPath, call: preciseCall, clock: fixedClock(1_000), n: 3 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const report = result.value;
    expect(report.n_per_fixture).toBe(10); // the protocol supersedes smaller N
    expect(report.curated.fixtures.length).toBe(16);
    expect(report.curated.scores.axis1_variance.pass).toBe(true); // zero entropy on known-bad
    expect(report.curated.scores.axis3_citation.pass).toBe(true); // every call aligned
    expect(report.quadrant_flags.find((f) => f.variant === "standard")?.rubber_stamp_quadrant).toBe(false);
  });

  it("a rubber-stamping variant lands in the High-similarity × Low-precision quadrant; the standard variant does not", async () => {
    const dispatch: FixtureVerifierCall = (fixture, i, variant) =>
      variant.name === "rubber-stamp" ? rubberStampCall(fixture, i, variant) : preciseCall(fixture, i, variant);
    const result = await runFreshnessAudit({
      thresholdsPath,
      call: dispatch,
      clock: fixedClock(1_000),
      variants: [{ name: "standard" }, { name: "rubber-stamp", systemPrompt: "always reject with a generic rationale" }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const standard = result.value.quadrant_flags.find((f) => f.variant === "standard")!;
    const planted = result.value.quadrant_flags.find((f) => f.variant === "rubber-stamp")!;
    expect(standard.rubber_stamp_quadrant).toBe(false);
    expect(planted.high_similarity).toBe(true);
    expect(planted.low_precision).toBe(true);
    expect(planted.rubber_stamp_quadrant).toBe(true);
    // A no-citation Verifier is flagged, never silently passed.
    expect(planted.no_citation_flag).toBe(true);
  });
});

describe("P5-T4 — the organic confirmation-pass cohort", () => {
  const confirmationTraces: SubAgentTrace[] = [
    trace({ trace_id: "tr_orig" }),
    trace({ trace_id: "tr_c1", confirmation_of_trace_id: "tr_orig" }),
    trace({ trace_id: "tr_c2", confirmation_of_trace_id: "tr_orig", confirmation_pass_outcome: "flaky_verdict_dismissed" }),
  ];

  it("confirmation triplets form a distinct, bias-annotated cohort", () => {
    const cohort = assembleOrganicCohort(confirmationTraces);
    expect(cohort).toBeDefined();
    expect(cohort!.selection).toBe("first-call-rejected");
    expect(cohort!.precision_not_comparable_to_curated).toBe(true);
    expect(cohort!.sample_count).toBe(1);
    expect(cohort!.samples[0]).toEqual({
      confirmation_of_trace_id: "tr_orig",
      confirmation_trace_ids: ["tr_c1", "tr_c2"],
      confirmation_pass_outcome: "flaky_verdict_dismissed",
    });
  });

  it("the curated baseline is unchanged by the organic cohort's presence", async () => {
    const without = await runFreshnessAudit({ thresholdsPath, call: preciseCall, clock: fixedClock(1_000) });
    const withOrganic = await runFreshnessAudit({ thresholdsPath, call: preciseCall, clock: fixedClock(1_000), traces: confirmationTraces });
    expect(without.success && withOrganic.success).toBe(true);
    if (!without.success || !withOrganic.success) return;

    expect(withOrganic.value.organic).toBeDefined();
    expect(without.value.organic).toBeUndefined();
    expect(withOrganic.value.curated).toEqual(without.value.curated); // never blended
  });
});
