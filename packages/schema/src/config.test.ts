import { describe, it, expect } from "vitest";

import { IntentConfigSchema } from "./config.js";

describe("IntentConfigSchema", () => {
  it("accepts a valid config with all fields", () => {
    const input = {
      version: "1.0.0",
      blocks: "./packages/blocks/canonical",
      intents_dir: ".ia/intents",
      scope_root: ".",
      hooks: {
        pre: { compose: "validate-intents" },
        post: { verify: "notify-slack" },
      },
      verification: {
        model_diversity: true,
        max_rounds: 3,
        confidence_threshold: 0.85,
      },
      storage: {
        cache: ".ia/cache",
        adherence: ".ia/adherence",
      },
    };

    const result = IntentConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("1.0.0");
      expect(result.data.verification?.max_rounds).toBe(3);
    }
  });

  it("accepts minimal config and applies defaults", () => {
    const input = {
      version: "0.1.0",
      blocks: "./blocks",
    };

    const result = IntentConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intents_dir).toBe(".ia/intents");
      expect(result.data.scope_root).toBe(".");
      expect(result.data.hooks).toBeUndefined();
      expect(result.data.verification).toBeUndefined();
      expect(result.data.storage).toBeUndefined();
    }
  });

  it("accepts config with optional sections", () => {
    const input = {
      version: "2.0.0-beta.1",
      blocks: "./blocks",
      hooks: { pre: { lint: "eslint ." } },
      verification: { model_diversity: false },
      storage: { cache: "/tmp/dusk-cache" },
    };

    const result = IntentConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks?.pre?.lint).toBe("eslint .");
      expect(result.data.verification?.model_diversity).toBe(false);
      expect(result.data.storage?.cache).toBe("/tmp/dusk-cache");
    }
  });

  it("rejects invalid semver versions", () => {
    const invalidVersions = ["abc", "1.2", "v1.0.0"];

    for (const version of invalidVersions) {
      const result = IntentConfigSchema.safeParse({
        version,
        blocks: "./blocks",
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects config missing required fields", () => {
    const missingVersion = { blocks: "./blocks" };
    const missingBlocks = { version: "1.0.0" };

    expect(IntentConfigSchema.safeParse(missingVersion).success).toBe(false);
    expect(IntentConfigSchema.safeParse(missingBlocks).success).toBe(false);
  });
});
