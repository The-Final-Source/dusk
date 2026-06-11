// @intent-test-file demo/feature/unit-tests
import { describe, it, expect } from "vitest";
import { runFeature } from "./feature.js";

function mirrorRunFeature(): string {
  return runFeature();
}

describe("runFeature", () => {
  it("returns the computed demo value", () => {
    expect(runFeature()).toBe(mirrorRunFeature()); // SEEDED: two-stage-test/mirror-implementation
  });
});
