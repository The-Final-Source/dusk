import { describe, expect, it } from "vitest";

import { parseIntentFile, writeIntentFile } from "./intentFile.js";

const validIntentYaml = `\
id: test-intent
scope: packages/test
adopts:
  - some-block
decisions:
  - point: framework
    choice: express
relates_to: []
constraints:
  - id: custom-rule
    text: Custom constraint for this project
    obligation: should
`;

describe("parseIntentFile", () => {
  it("parses valid intent YAML", () => {
    const result = parseIntentFile(validIntentYaml);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.id).toBe("test-intent");
    expect(result.data.scope).toBe("packages/test");
    expect(result.data.adopts).toEqual(["some-block"]);
    expect(result.data.decisions).toHaveLength(1);
    expect(result.data.decisions[0]).toEqual({
      point: "framework",
      choice: "express",
    });
    expect(result.data.constraints).toHaveLength(1);
    expect(result.data.constraints[0]).toMatchObject({
      id: "custom-rule",
      text: "Custom constraint for this project",
      obligation: "should",
      negative: false,
    });
  });

  it("round-trips: parse → write → parse produces equivalent data", () => {
    const first = parseIntentFile(validIntentYaml);
    expect(first.success).toBe(true);
    if (!first.success) return;

    const written = writeIntentFile(first.data);
    const second = parseIntentFile(written);

    expect(second.success).toBe(true);
    if (!second.success) return;

    expect(second.data).toEqual(first.data);
  });

  it("returns YAML_PARSE_ERROR for invalid YAML", () => {
    const badYaml = ":\n  :\n    - [invalid";
    const result = parseIntentFile(badYaml, "bad.yaml");

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("YAML_PARSE_ERROR");
    expect(result.errors[0].file).toBe("bad.yaml");
  });

  it("returns schema validation errors for missing required field", () => {
    const missingId = `\
scope: packages/test
adopts: []
`;
    const result = parseIntentFile(missingId, "intent.yaml");

    expect(result.success).toBe(false);
    if (result.success) return;

    const idError = result.errors.find((e) => e.path.includes("id"));
    expect(idError).toBeDefined();
    expect(idError!.file).toBe("intent.yaml");
  });

  it("accepts empty adopts array", () => {
    const yaml = `\
id: minimal-intent
scope: packages/minimal
adopts: []
`;
    const result = parseIntentFile(yaml);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.adopts).toEqual([]);
    expect(result.data.decisions).toEqual([]);
    expect(result.data.relates_to).toEqual([]);
    expect(result.data.constraints).toEqual([]);
  });
});
