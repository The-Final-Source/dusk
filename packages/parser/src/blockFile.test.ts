import { describe, it, expect } from "vitest";

import { parseBlockFile, writeBlockFile } from "./blockFile.js";

const validBlockYaml = `
id: test-block
version: "1.0.0"
layer: api
summary: Test block for parser verification
constraints:
  - id: test-constraint
    text: All inputs must be validated
    obligation: must
    verifiability: mechanical
`.trim();

describe("parseBlockFile", () => {
  it("parses valid block YAML successfully", () => {
    const result = parseBlockFile(validBlockYaml);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.id).toBe("test-block");
    expect(result.data.version).toBe("1.0.0");
    expect(result.data.layer).toBe("api");
    expect(result.data.summary).toBe("Test block for parser verification");
    expect(result.data.constraints).toHaveLength(1);
    expect(result.data.constraints[0].id).toBe("test-constraint");
    expect(result.data.constraints[0].obligation).toBe("must");
    expect(result.data.constraints[0].verifiability).toBe("mechanical");
  });

  it("round-trips through write and parse producing equivalent data", () => {
    const first = parseBlockFile(validBlockYaml);
    expect(first.success).toBe(true);
    if (!first.success) return;

    const written = writeBlockFile(first.data);
    const second = parseBlockFile(written);

    expect(second.success).toBe(true);
    if (!second.success) return;

    expect(second.data).toEqual(first.data);
  });

  it("returns YAML_PARSE_ERROR for invalid YAML syntax", () => {
    const badYaml = "id: test\n  invalid: [unclosed";
    const result = parseBlockFile(badYaml, "bad.block.yaml");

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("YAML_PARSE_ERROR");
    expect(result.errors[0].file).toBe("bad.block.yaml");
  });

  it("returns schema validation errors for missing required fields", () => {
    const missingId = `
version: "1.0.0"
layer: api
summary: Missing id field
constraints:
  - id: c1
    text: Some constraint
    obligation: must
    verifiability: mechanical
`.trim();
    const result = parseBlockFile(missingId, "missing.block.yaml");

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.errors.length).toBeGreaterThan(0);
    const idError = result.errors.find((e) => e.path.includes("id"));
    expect(idError).toBeDefined();
    expect(idError!.file).toBe("missing.block.yaml");
  });

  it("returns error with path pointing to constraints when verifiability is missing", () => {
    const missingVerifiability = `
id: test-block
version: "1.0.0"
layer: api
summary: Test block
constraints:
  - id: c1
    text: Some constraint
    obligation: must
`.trim();
    const result = parseBlockFile(missingVerifiability);

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.errors.length).toBeGreaterThan(0);
    const constraintError = result.errors.find((e) =>
      e.path.some((p) => p === "constraints" || p === "0" || p === "verifiability"),
    );
    expect(constraintError).toBeDefined();
  });
});
