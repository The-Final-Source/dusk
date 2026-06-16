import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // cli.test.ts spawns the gate binary as a real subprocess (wire contract).
    // Budget tests + setup hooks for out-of-process cost so scheduling jitter
    // under parallel load can't trip the unit-calibrated defaults (5s/10s).
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
