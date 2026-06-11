import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { IntentSchema, type Intent } from "@dusk/core-schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildSeededManifest, seededViolationsRoot, type SeededFixture } from "./fixtureManifest.js";

// 3.2 / 3.3 / 3.4 — fixture authoring validation + the marker drift guard
// (design D7). Zero-model.

const loadIntents = (fixture: SeededFixture): Intent[] =>
  fixture.files
    .filter((f) => f.startsWith("intents/") && f.endsWith("intent.yaml"))
    .map((f) => IntentSchema.parse(parseYaml(readFileSync(join(fixture.dir, f), "utf8"))));

describe("the authored set builds clean at the documented scale", () => {
  const result = buildSeededManifest();

  it("builds the manifest over the authored fixtures", () => {
    expect(result.success).toBe(true);
  });

  it("covers all four classes at the documented per-class counts (~60 total)", () => {
    if (!result.success) return;
    expect(result.value.fixture_count).toBe(60);
    expect(result.value.classes).toEqual({ mechanical: 14, "static-analysis": 10, verification: 24, "two-stage-test": 12 });
  });

  it("every seeded-bad fixture carries ground_truth_outcome + ground_truth_defect_loc", () => {
    if (!result.success) return;
    for (const f of result.value.fixtures) {
      if (f.ground_truth_outcome === "verifier_accept") {
        expect(f.ground_truth_defect_loc).toBeUndefined();
      } else {
        expect(f.ground_truth_defect_loc, `fixture ${f.id} is missing its defect loc`).toBeDefined();
      }
    }
  });

  it("every mechanical fixture names its expected rejection kind, covering the 12-kind surface", () => {
    if (!result.success) return;
    const mechanical = result.value.fixtures.filter((f) => f.class === "mechanical");
    const kinds = new Set(mechanical.map((f) => f.expected_rejection_kind));
    expect(kinds).toEqual(
      new Set([
        "missing_decorator",
        "missing_statement_decorator",
        "unresolved_intent_path",
        "unresolved_aspect_id",
        "multiple_intents_on_one_line",
        "missing_ignore_because",
        "missing_ignore_reason",
        "invalid_ignore_predicate",
        "missing_support_triple",
        "malformed_support_triple",
        "focal_and_support_for_same_intent",
        "non_test_path_on_intent_test",
      ]),
    );
  });

  it("the verification class contains ≥3 quantifier, ≥3 implies-consequent, and ≥3 negative-polarity cases", () => {
    if (!result.success) return;
    const verification = result.value.fixtures.filter((f) => f.class === "verification" && f.ground_truth_outcome === "verifier_reject");
    const has = (predicate: (i: Intent) => boolean) => verification.filter((f) => loadIntents(f).some(predicate));
    expect(has((i) => (i.triples ?? []).some((t) => t.quantifier !== undefined)).length).toBeGreaterThanOrEqual(3);
    expect(has((i) => i.compose === "implies").length).toBeGreaterThanOrEqual(3);
    expect(has((i) => (i.triples ?? []).some((t) => t.polarity === "negative")).length).toBeGreaterThanOrEqual(3);
  });

  it("the calibration split is declared in fixture metadata (design Q4)", () => {
    if (!result.success) return;
    expect(result.value.calibration_fixture_ids.length).toBeGreaterThanOrEqual(8);
    const calibration = result.value.fixtures.filter((f) => f.calibration === true);
    const outcomes = new Set(calibration.map((f) => f.ground_truth_outcome));
    // The held-out split is the controversial/known-good set — never known-bad.
    expect(outcomes).toEqual(new Set(["verifier_accept", "controversial"]));
  });

  it("every fixture's intent files parse against the Intent schema", () => {
    if (!result.success) return;
    for (const f of result.value.fixtures) {
      expect(() => loadIntents(f), `fixture ${f.id} has invalid intents`).not.toThrow();
      expect(loadIntents(f).length).toBeGreaterThan(0);
    }
  });
});

describe("the marker drift guard (D7)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dusk-seeded-"));
    cpSync(seededViolationsRoot(), tmp, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("a drifted defect location fails the manifest build naming the fixture", () => {
    // Shift the defect line of one fixture without updating fixture.yaml.
    const src = join(tmp, "verification/negative-raw-sql/src.ts");
    writeFileSync(src, `// an innocent-looking edit that shifts every line below it\n${readFileSync(src, "utf8")}`, "utf8");

    const result = buildSeededManifest(tmp);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.message).toContain("verification/negative-raw-sql");
    expect(result.error.message).toContain("drifted");
  });

  it("aligned markers build clean", () => {
    const result = buildSeededManifest(tmp);
    expect(result.success).toBe(true);
  });
});
