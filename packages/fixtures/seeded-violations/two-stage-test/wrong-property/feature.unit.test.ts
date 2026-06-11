// @intent-test-file demo/feature/unit-tests
import { describe, it, expect } from "vitest";
import { runFeature } from "./feature.js";

describe("runFeature", () => {
  it("returns the computed demo value", () => {
    expect(runFeature().length).toBeGreaterThan(0); // SEEDED: two-stage-test/wrong-property
  });
});
