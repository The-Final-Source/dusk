import { describe, expect, it } from "vitest";

import { parseConfigFile } from "./configFile.js";

describe("parseConfigFile", () => {
  it("parses valid config YAML with defaults", () => {
    const yaml = `version: "1.0.0"\nblocks: ./blocks\n`;
    const result = parseConfigFile(yaml);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.version).toBe("1.0.0");
    expect(result.data.blocks).toBe("./blocks");
    expect(result.data.intents_dir).toBe(".ia/intents");
    expect(result.data.scope_root).toBe(".");
  });

  it("parses full config with all optional sections", () => {
    const yaml = [
      'version: "1.0.0"',
      "blocks: ./blocks",
      "intents_dir: custom/intents",
      "scope_root: ./src",
      "hooks:",
      "  pre:",
      '    validate: "echo checking"',
      "  post:",
      '    validate: "echo done"',
      "verification:",
      "  model_diversity: true",
      "  max_rounds: 3",
      "  confidence_threshold: 0.85",
      "storage:",
      "  cache: .cache",
      "  adherence: .adherence",
    ].join("\n");

    const result = parseConfigFile(yaml);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.intents_dir).toBe("custom/intents");
    expect(result.data.scope_root).toBe("./src");
    expect(result.data.hooks?.pre?.validate).toBe("echo checking");
    expect(result.data.hooks?.post?.validate).toBe("echo done");
    expect(result.data.verification?.model_diversity).toBe(true);
    expect(result.data.verification?.max_rounds).toBe(3);
    expect(result.data.verification?.confidence_threshold).toBe(0.85);
    expect(result.data.storage?.cache).toBe(".cache");
    expect(result.data.storage?.adherence).toBe(".adherence");
  });

  it("returns YAML_PARSE_ERROR for invalid YAML", () => {
    const yaml = ":\n  :\n    - ][";
    const result = parseConfigFile(yaml, "dusk.config.yml");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].code).toBe("YAML_PARSE_ERROR");
    expect(result.errors[0].file).toBe("dusk.config.yml");
  });

  it("returns clear error with path when required field is missing", () => {
    const yaml = "blocks: ./blocks\n";
    const result = parseConfigFile(yaml);

    expect(result.success).toBe(false);
    if (result.success) return;
    const versionError = result.errors.find((e) => e.path.includes("version"));
    expect(versionError).toBeDefined();
    expect(versionError!.message).toBeDefined();
  });

  it("returns validation error for invalid semver", () => {
    const yaml = `version: "not-semver"\nblocks: ./blocks\n`;
    const result = parseConfigFile(yaml);

    expect(result.success).toBe(false);
    if (result.success) return;
    const versionError = result.errors.find((e) => e.path.includes("version"));
    expect(versionError).toBeDefined();
    expect(versionError!.message).toContain("semver");
  });
});
