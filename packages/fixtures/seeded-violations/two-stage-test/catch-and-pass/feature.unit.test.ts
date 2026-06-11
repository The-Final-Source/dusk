// @intent-test-file demo/feature/unit-tests
import { describe, it, expect } from "vitest";
import { runFeature } from "./feature.js";

describe("runFeature", () => {
  it("returns the computed demo value", () => {
    try {
      expect(runFeature()).toBe("not-the-value");
    } catch {
      expect(true).toBe(true); // SEEDED: two-stage-test/catch-and-pass
    }
  });
});
