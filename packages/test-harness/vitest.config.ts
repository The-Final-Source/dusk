import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // harness.test.ts / phase3Harness.test.ts spawn real git + hook subprocesses.
    // Budget tests + setup hooks for out-of-process cost so scheduling jitter
    // under parallel load can't trip the unit-calibrated defaults (5s/10s).
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
