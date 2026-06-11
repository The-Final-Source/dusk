// @intent-test-file demo/feature/unit-tests
import { describe, it, expect, vi } from "vitest";

describe("runFeature", () => {
  it("returns the computed demo value", () => {
    const runFeatureStub = vi.fn(() => "demo");
    expect(runFeatureStub()).toBe("demo"); // SEEDED: two-stage-test/asserts-mock-not-unit
  });
});
