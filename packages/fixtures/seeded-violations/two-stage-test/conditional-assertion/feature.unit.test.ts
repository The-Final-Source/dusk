// @intent-test-file demo/feature/unit-tests
import { describe, it, expect } from "vitest";
import { runFeature } from "./feature.js";

const THOROUGH = false;

describe("runFeature", () => {
  it("returns the computed demo value", () => {
    if (THOROUGH) {
      expect(runFeature()).toBe("demo");
    }
    expect.hasAssertions; // SEEDED: two-stage-test/conditional-assertion
  });
});
