// @intent-test-file demo/feature/unit-tests
import { describe, it, expect } from "vitest";
import { runFeature } from "./feature.js";

describe("runFeature", () => {
  it("returns the computed demo value", () => {
    expect(typeof runFeature()).toBe("string"); // SEEDED: two-stage-test/type-only
  });
});
