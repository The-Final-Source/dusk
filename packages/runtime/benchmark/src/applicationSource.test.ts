import { describe, expect, it } from "vitest";

import { classifyApplicationSource, isTrailerRequired } from "./applicationSource.js";

// Phase-6 §5.1 — the application-source predicate (design D4, provenance axis).
// Pure, zero-model. Required = runtime app source + pyramid test bodies; exempt =
// the enumerated scaffold allowlist; UNKNOWN → required (fail-safe).

describe("classifyApplicationSource — the provenance-axis allowlist (D4)", () => {
  it("classifies a non-allowlisted source file as required (zero-handwritten-audit scenario)", () => {
    const result = classifyApplicationSource("src/notifications/sendNotification.ts");
    expect(result.classification).toBe("required");
    expect(isTrailerRequired("src/notifications/sendNotification.ts")).toBe(true);
  });

  it("classifies the Vitest globalSetup as exempt scaffold (zero-handwritten-audit scenario)", () => {
    const result = classifyApplicationSource("test/globalSetup.ts");
    expect(result.classification).toBe("exempt");
    expect(result.reason).toBe("vitest-global-setup");
  });

  it("an unknown/novel path defaults to required (fail-safe)", () => {
    expect(classifyApplicationSource("src/some/brand-new/area/handler.ts").classification).toBe("required");
    expect(classifyApplicationSource("weird-top-level-thing.ts").classification).toBe("required");
  });

  it("test bodies under every pyramid suffix are trailer-required even when nested", () => {
    expect(isTrailerRequired("src/api/list/unit-tests/cursor.test.ts")).toBe(true);
    expect(isTrailerRequired("src/api/write/integration-tests/idempotency.test.ts")).toBe(true);
    expect(isTrailerRequired("src/api/write/e2e-tests/http.test.ts")).toBe(true);
  });

  it("the enumerated scaffold allowlist is exempt", () => {
    const exempt = [
      "package.json",
      "tsconfig.json",
      "tsconfig.build.json",
      "vitest.config.ts",
      "drizzle.config.ts",
      "docker-compose.yml",
      "docker-compose.test.yaml",
      ".env.example",
      ".gitignore",
      ".ia/intents/api/foo/intent.yaml",
      "drizzle/0000_init.sql",
      "src/db/migrations/0001_add_table.sql",
      "test/app-boot.ts",
      "test/dusk-reporter.ts",
    ];
    for (const path of exempt) {
      expect(classifyApplicationSource(path).classification).toBe("exempt");
    }
  });

  it("normalizes leading ./ and backslashes before classifying", () => {
    expect(classifyApplicationSource("./package.json").classification).toBe("exempt");
    expect(classifyApplicationSource("src\\api\\unit-tests\\x.test.ts").classification).toBe("required");
  });
});
