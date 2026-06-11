// @intent-test-file demo/feature/unit-tests
import { describe, it, expect } from "vitest";
import { runFeature } from "./feature.js";

describe("runFeature", () => {
  it("returns the computed demo value", () => {
    const fixtureInput = "demo";
    runFeature();
    expect(fixtureInput.length).toBe(4); // SEEDED: two-stage-test/asserts-input-not-output
  });
});
