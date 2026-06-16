import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 60_000,
    hookTimeout: 60_000, // beforeEach git init/clone is out-of-process — match the test budget (default 10s flakes under load)
  },
});
