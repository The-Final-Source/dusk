import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    root: import.meta.dirname,
    include: ["src/**/*.test.ts"],
  },
});
