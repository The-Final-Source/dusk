import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixedClock } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendDogfoodEvent, evaluateDogfood, type DogfoodEvent } from "./dogfood.js";

// P5-T11 (11.2) — the go/no-go evaluation is a deterministic, re-runnable pure
// pass over collected window data; gates and exploration are structurally
// separated. Zero-model.

const T0 = Date.parse("2026-06-11T00:00:00.000Z");
const at = (day: number): string => new Date(T0 + day * 24 * 60 * 60 * 1000).toISOString();

const windowEvents: DogfoodEvent[] = [
  { kind: "window_started", at: at(0), package: "packages/shared", first_decorated_commit: "abc1234" },
  { kind: "gate_event", at: at(1), decision: "block", false_positive: false, note: "legit rejection while decorating" },
  { kind: "implement_run", at: at(2), success: true, commit_sha: "def5678", trailers_complete: true, iterations: 2, stuckness_fired: false, livelock: false },
  { kind: "doctor_run", at: at(3), mode: "conservative", findings: 1 },
  { kind: "doctor_run", at: at(10), mode: "conservative", findings: 0 },
  { kind: "worked_example_regression", at: at(7), status: "clean" },
  { kind: "package_test_suite", at: at(7), status: "green" },
  { kind: "author_dialog", at: at(1), branches: 1 },
  { kind: "friction", at: at(4), observation: "verifier prompt needed clearer focal framing", commit_sha: "fff0001", commit_summary: "feat(roles): clarify focal framing" },
  { kind: "api_expansion", at: at(9), note: "authored first packages/api intents" },
];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dusk-dogfood-"));
  for (const e of windowEvents) appendDogfoodEvent(root, e);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const clock = fixedClock(T0 + 15 * 24 * 60 * 60 * 1000);

describe("the go/no-go evaluation is deterministic and re-runnable", () => {
  it("same data → identical report; the gating section evaluates exactly the four named thresholds", () => {
    const first = evaluateDogfood({ root, clock });
    const second = evaluateDogfood({ root, clock });
    expect(first.success && second.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(second.value).toEqual(first.value);

    const report = first.value;
    expect(report.window.days).toBe(15);
    expect(Object.keys(report.gating).sort()).toEqual([
      "e2e_implement_success_count",
      "gate_false_positive_count",
      "package_test_suite",
      "pass",
      "worked_example_regression",
    ]);
    expect(report.gating).toMatchObject({
      e2e_implement_success_count: { value: 1, pass: true },
      gate_false_positive_count: { value: 0, pass: true },
      worked_example_regression: { value: "clean", pass: true },
      package_test_suite: { value: "green", pass: true },
      pass: true,
    });
  });

  it("exploratory metrics never appear in gating, and the exploratory section is labeled gating: false", () => {
    const result = evaluateDogfood({ root, clock });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.exploratory.gating).toBe(false);
    expect(result.value.exploratory.iteration_distribution).toEqual({ "2": 1 });
    expect(result.value.exploratory.doctor_finding_trend).toHaveLength(2);
    expect(JSON.stringify(result.value.gating)).not.toContain("iteration");
  });

  it("friction-driven prompt edits are traceable; API expansion is recorded but not gated", () => {
    const result = evaluateDogfood({ root, clock });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.exploratory.friction_commits).toEqual([{ sha: "fff0001", summary: "feat(roles): clarify focal framing" }]);
    expect(result.value.exploratory.api_expansion.begun).toBe(true);

    // The api-expansion state has no effect on the gating verdict.
    const without = mkdtempSync(join(tmpdir(), "dusk-dogfood-noapi-"));
    try {
      for (const e of windowEvents.filter((e) => e.kind !== "api_expansion")) appendDogfoodEvent(without, e);
      const noApi = evaluateDogfood({ root: without, clock });
      expect(noApi.success).toBe(true);
      if (!noApi.success) return;
      expect(noApi.value.gating).toEqual(result.value.gating);
    } finally {
      rmSync(without, { recursive: true, force: true });
    }
  });

  it("a gate false positive or a missing gate signal fails the gating verdict honestly", () => {
    appendDogfoodEvent(root, { kind: "gate_event", at: at(11), decision: "block", false_positive: true, note: "rejected a legitimate write" });
    const result = evaluateDogfood({ root, clock });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.gating.gate_false_positive_count).toMatchObject({ value: 1, pass: false });
    expect(result.value.gating.pass).toBe(false);

    // No data is never a pass: a window with no suite signal fails that gate.
    const empty = mkdtempSync(join(tmpdir(), "dusk-dogfood-empty-"));
    try {
      appendDogfoodEvent(empty, windowEvents[0]);
      const sparse = evaluateDogfood({ root: empty, clock });
      expect(sparse.success).toBe(true);
      if (!sparse.success) return;
      expect(sparse.value.gating.package_test_suite.pass).toBe(false);
      expect(sparse.value.gating.worked_example_regression.pass).toBe(false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
