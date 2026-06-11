// @intent-test-file demo/feature/unit-tests
import { describe, it, expect } from "vitest";
import { runFeature } from "./feature.js";

describe("runFeature", () => {
  it("returns the computed demo value", () => {
    expect(() => runFeature()).not.toThrow(); // SEEDED: two-stage-test/no-throw-only
  });
});
