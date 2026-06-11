// @intent-test-file demo/feature/unit-tests
import { describe, it, expect } from "vitest";
import { runFeature } from "./feature.js";

describe("runFeature", () => {
  it("returns the computed demo value", () => {
    const expected = "demo";
    runFeature();
    expect(expected).toBe("demo"); // SEEDED: two-stage-test/asserts-input-not-output
  });
});
