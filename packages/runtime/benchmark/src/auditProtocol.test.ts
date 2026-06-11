import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixedClock } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runFreshnessAudit, knownBadFixtures, type FixtureVerifierCall } from "./auditRunner.js";
import { frozenThresholds } from "./testSupport.js";

// 4.3 — pre-registration enforcement (design D1). Zero-model: every refusal
// path returns a typed error BEFORE any model call; `call` throws if reached.

const neverCalled: FixtureVerifierCall = () => {
  throw new Error("the audit must refuse BEFORE any model call");
};

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "dusk-audit-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const audit = (thresholdsPath: string) =>
  runFreshnessAudit({ thresholdsPath, call: neverCalled, clock: fixedClock(1_000) });

describe("the audit refuses to score without frozen thresholds (D1)", () => {
  it("absent thresholds file → typed refusal, nothing scored", async () => {
    const result = await audit(join(tmp, "audit-thresholds.json"));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.kind).toBe("config_invalid");
    expect(result.error.details?.refusal).toBe("missing_pre_registration");
  });

  it("frozen !== true → typed refusal, nothing scored", async () => {
    const path = join(tmp, "audit-thresholds.json");
    writeFileSync(path, JSON.stringify({ ...frozenThresholds(), frozen: false }), "utf8");
    const result = await audit(path);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.details?.refusal).toBe("not_frozen");
  });

  it("calibration/test overlap → typed refusal naming the overlapping ids", async () => {
    const scored = knownBadFixtures();
    expect(scored.success).toBe(true);
    if (!scored.success) return;
    const overlapping = scored.value[0].id;

    const path = join(tmp, "audit-thresholds.json");
    writeFileSync(path, JSON.stringify(frozenThresholds({ calibration_fixture_ids: [overlapping] })), "utf8");
    const result = await audit(path);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.details?.refusal).toBe("calibration_overlap");
    expect(result.error.message).toContain(overlapping);
  });
});

describe("the scored set is the curated known-bad split", () => {
  it("contains exactly the non-calibration verifier_reject verification fixtures", () => {
    const scored = knownBadFixtures();
    expect(scored.success).toBe(true);
    if (!scored.success) return;
    expect(scored.value.length).toBe(16);
    for (const f of scored.value) {
      expect(f.class).toBe("verification");
      expect(f.ground_truth_outcome).toBe("verifier_reject");
      expect(f.calibration).not.toBe(true);
    }
  });
});
