import { describe, it, expect } from "vitest";

import { parseAuditFile, writeAuditFile } from "./auditFile.js";

const validAuditJson = {
  intent: "test-intent",
  composed_at: "2025-01-15T10:00:00Z",
  composition_version: "1.0.0",
  decisions: [
    {
      type: "concern_assignment",
      category: "additive",
      source: "concern_hint",
      confidence: 0.92,
      rationale: "Assigned constraint to concern based on hint",
    },
  ],
};

describe("parseAuditFile", () => {
  it("parses valid audit JSON", () => {
    const content = JSON.stringify(validAuditJson);
    const result = parseAuditFile(content);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe("test-intent");
      expect(result.data.decisions).toHaveLength(1);
      expect(result.data.decisions[0].type).toBe("concern_assignment");
    }
  });

  it("round-trips through write and parse", () => {
    const content = JSON.stringify(validAuditJson);
    const first = parseAuditFile(content);
    expect(first.success).toBe(true);
    if (!first.success) return;

    const written = writeAuditFile(first.data);
    const second = parseAuditFile(written);
    expect(second.success).toBe(true);
    if (!second.success) return;

    expect(second.data).toEqual(first.data);
  });

  it("returns JSON_PARSE_ERROR for invalid JSON", () => {
    const result = parseAuditFile("{not valid json", "audit.json");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("JSON_PARSE_ERROR");
      expect(result.errors[0].file).toBe("audit.json");
    }
  });

  it("returns schema validation errors with path for invalid decision type", () => {
    const invalid = {
      ...validAuditJson,
      decisions: [
        {
          type: "invalid_type",
          category: "additive",
          source: "concern_hint",
          confidence: 0.5,
          rationale: "test",
        },
      ],
    };
    const result = parseAuditFile(JSON.stringify(invalid), "audit.json");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      const typeError = result.errors.find((e) =>
        e.path.includes("type"),
      );
      expect(typeError).toBeDefined();
      expect(typeError!.file).toBe("audit.json");
    }
  });
});

describe("writeAuditFile", () => {
  it("produces pretty-printed JSON with trailing newline", () => {
    const content = JSON.stringify(validAuditJson);
    const parsed = parseAuditFile(content);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const output = writeAuditFile(parsed.data);
    expect(output).toBe(JSON.stringify(parsed.data, null, 2) + "\n");
    expect(output.endsWith("\n")).toBe(true);
  });
});
