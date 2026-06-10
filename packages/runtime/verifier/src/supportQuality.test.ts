import { describe, expect, test } from "vitest";

import { aggregateSupportQuality } from "./supportQuality.js";

// Task 5.7 / P2-T9 — support_quality aggregation rule (unit-only, pure).

describe("aggregateSupportQuality", () => {
  test.each([
    [["matches", "matches"], "ok"],
    [["matches", "mismatch"], "low_confidence"],
    [["vague", "vague", "matches", "matches"], "low_confidence"],
    [["vague", "matches", "matches"], "ok"],
    [[], "ok"],
  ] as const)("%j → %s", (verdicts, expected) => {
    expect(aggregateSupportQuality(verdicts as never)).toBe(expected);
  });
});
