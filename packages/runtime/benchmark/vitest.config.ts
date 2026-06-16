import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 600_000,
    hookTimeout: 60_000, // git/subprocess setup hooks — bound for out-of-process cost (default 10s flakes under load)
  },
});
