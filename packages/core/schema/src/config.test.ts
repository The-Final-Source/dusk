import { describe, test, expect } from "vitest";

import { DuskConfigSchema, testPyramidSuffixes } from "./config.js";

describe("DuskConfigSchema", () => {
  test("applies suffix defaults and passes through unknown sections", () => {
    const config = DuskConfigSchema.parse({ version: 1, sanity: { long_cycle_round_count: 10 } });
    expect(testPyramidSuffixes(config)).toEqual(["unit-tests", "integration-tests", "e2e-tests"]);
    expect((config as Record<string, unknown>).sanity).toEqual({ long_cycle_round_count: 10 });
  });

  test("honors configured suffixes", () => {
    const config = DuskConfigSchema.parse({ test_pyramid: { suffixes: ["unit-tests", "contract-tests"] } });
    expect(testPyramidSuffixes(config)).toContain("contract-tests");
  });
});
