import { describe, test, expect } from "vitest";

import { DEFAULT_TRACE_RING_BYTES, DuskConfigSchema, testPyramidSuffixes, traceMirrors, traceRingBytes } from "./config.js";

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

  // 1.3 — the observability block is additive; defaults preserve current behavior.
  test("loads without the observability block (64 MiB ring, no mirrors)", () => {
    const config = DuskConfigSchema.parse({ version: 1 });
    expect(traceRingBytes(config)).toBe(DEFAULT_TRACE_RING_BYTES);
    expect(traceMirrors(config)).toEqual([]);
  });

  test("loads with the observability block", () => {
    const config = DuskConfigSchema.parse({
      observability: {
        trace_ring_bytes: 1024,
        mirrors: [{ sink: "otlp", endpoint: "http://127.0.0.1:4318/v1/logs" }],
      },
    });
    expect(traceRingBytes(config)).toBe(1024);
    expect(traceMirrors(config)).toEqual([{ sink: "otlp", endpoint: "http://127.0.0.1:4318/v1/logs" }]);
  });
});
