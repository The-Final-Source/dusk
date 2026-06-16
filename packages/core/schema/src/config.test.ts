import { describe, test, expect } from "vitest";

import { DEFAULT_TRACE_RING_BYTES, DuskConfigSchema, isTestIntentPath, testPyramidSuffixes, traceMirrors, traceRingBytes } from "./config.js";

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

// D.32 / D7 — the one shared test-identity predicate. The single source of
// truth consumed by the CLI verifier, the orchestrator, and dusk_inspect.
describe("isTestIntentPath", () => {
  const defaults = DuskConfigSchema.parse({});

  test("a nested intent ending in a default suffix is a test intent", () => {
    expect(isTestIntentPath("app/notifications/unit-tests", defaults)).toBe(true);
    expect(isTestIntentPath("app/notifications/integration-tests", defaults)).toBe(true);
    expect(isTestIntentPath("app/notifications/e2e-tests", defaults)).toBe(true);
  });

  test("a non-suffix intent is not a test intent", () => {
    expect(isTestIntentPath("app/notifications/send", defaults)).toBe(false);
    expect(isTestIntentPath("app/notifications/unit-tests-helper", defaults)).toBe(false);
  });

  test("requires a leading slash before the suffix (no bare top-level match)", () => {
    expect(isTestIntentPath("unit-tests", defaults)).toBe(false);
  });

  // The latent config-divergence bug fixed by routing dusk_inspect through this
  // predicate: it now honors dusk.config.yml suffix overrides, and no longer
  // treats the former hardcoded contract-tests/property-tests as test intents
  // under default config.
  test("honors configured suffix overrides", () => {
    const custom = DuskConfigSchema.parse({ test_pyramid: { suffixes: ["unit-tests", "contract-tests"] } });
    expect(isTestIntentPath("app/x/contract-tests", custom)).toBe(true);
    // not configured under this project's overrides
    expect(isTestIntentPath("app/x/e2e-tests", custom)).toBe(false);
  });

  test("contract-tests/property-tests are NOT test intents under default config", () => {
    expect(isTestIntentPath("app/x/contract-tests", defaults)).toBe(false);
    expect(isTestIntentPath("app/x/property-tests", defaults)).toBe(false);
  });
});
