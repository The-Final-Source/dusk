// @intent-test-file demo/feature/unit-tests
import { describe, it, expect } from "vitest";
import { runFeature } from "./feature.js";

describe("runFeature", () => {
  it("returns the computed demo value", () => {
    console.log(runFeature());
    expect(1).toBe(1); // SEEDED: two-stage-test/console-log-only
  });
});
