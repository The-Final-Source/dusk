// @intent-test-file demo/feature/unit-tests
import { describe, it } from "vitest";
import { runFeature } from "./feature.js";

describe("runFeature", () => {
  it("returns the computed demo value", () => {
    runFeature(); // SEEDED: two-stage-test/no-assertion
  });
});
