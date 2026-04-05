import { describe, expect, it } from "vitest";

import { parseSourceMapFile, writeSourceMapFile } from "./sourceMapFile.js";

const validSourceMap = {
  intent: "test-intent",
  intent_hash:
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  synced_at: "2025-01-15T10:30:00Z",
  stale: false,
  mappings: [
    {
      constraint: "test-constraint",
      files: [
        {
          path: "src/test.ts",
          confidence: 0.95,
          provenance: "annotation",
        },
      ],
    },
  ],
};

const validJson = JSON.stringify(validSourceMap, null, 2);

describe("parseSourceMapFile", () => {
  it("parses valid JSON successfully", () => {
    const result = parseSourceMapFile(validJson);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe("test-intent");
      expect(result.data.mappings).toHaveLength(1);
      expect(result.data.mappings[0].files[0].confidence).toBe(0.95);
    }
  });

  it("round-trips through write and parse", () => {
    const first = parseSourceMapFile(validJson);
    expect(first.success).toBe(true);
    if (!first.success) return;

    const written = writeSourceMapFile(first.data);
    const second = parseSourceMapFile(written);
    expect(second.success).toBe(true);
    if (!second.success) return;

    expect(second.data).toEqual(first.data);
  });

  it("returns JSON_PARSE_ERROR for invalid JSON", () => {
    const result = parseSourceMapFile("{not valid json}");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("JSON_PARSE_ERROR");
      expect(result.errors[0].message).not.toContain("at Object");
    }
  });

  it("returns schema errors with correct paths for bad hash", () => {
    const bad = JSON.stringify({
      ...validSourceMap,
      intent_hash: "too-short",
    });
    const result = parseSourceMapFile(bad, "source-map.json");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      const hashError = result.errors.find((e) =>
        e.path.includes("intent_hash")
      );
      expect(hashError).toBeDefined();
      expect(hashError!.file).toBe("source-map.json");
    }
  });
});

describe("writeSourceMapFile", () => {
  it("produces pretty-printed JSON with trailing newline", () => {
    const first = parseSourceMapFile(validJson);
    expect(first.success).toBe(true);
    if (!first.success) return;

    const output = writeSourceMapFile(first.data);
    expect(output).toContain("\n");
    expect(output.endsWith("\n")).toBe(true);
    expect(output).toBe(JSON.stringify(first.data, null, 2) + "\n");
  });
});
