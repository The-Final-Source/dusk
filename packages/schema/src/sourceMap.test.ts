import { describe, it, expect } from "vitest";

import { SourceMapSchema } from "./sourceMap.js";

const validHash = "a".repeat(64);

const validSourceMap = {
  intent: "todo-app",
  intent_hash: validHash,
  synced_at: "2026-01-15T10:30:00Z",
  stale: true,
  mappings: [
    {
      constraint: "auth-require-jwt",
      files: [
        {
          path: "src/auth/middleware.ts",
          confidence: 0.95,
          provenance: "annotation" as const,
          last_confirmed: "2026-01-15T10:00:00Z",
        },
      ],
      unmapped: ["some-unresolved-ref"],
    },
  ],
};

describe("SourceMapSchema", () => {
  it("accepts a valid source map with complete fields", () => {
    const result = SourceMapSchema.safeParse(validSourceMap);
    expect(result.success).toBe(true);
  });

  it("defaults stale to false when omitted", () => {
    const { stale, ...withoutStale } = validSourceMap;
    const result = SourceMapSchema.parse(withoutStale);
    expect(result.stale).toBe(false);
  });

  it("rejects invalid SHA-256 hash — too short", () => {
    const result = SourceMapSchema.safeParse({
      ...validSourceMap,
      intent_hash: "abcd1234",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid SHA-256 hash — uppercase", () => {
    const result = SourceMapSchema.safeParse({
      ...validSourceMap,
      intent_hash: "A".repeat(64),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid SHA-256 hash — non-hex characters", () => {
    const result = SourceMapSchema.safeParse({
      ...validSourceMap,
      intent_hash: "g".repeat(64),
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence out of range — too high", () => {
    const result = SourceMapSchema.safeParse({
      ...validSourceMap,
      mappings: [
        {
          constraint: "c1",
          files: [{ path: "a.ts", confidence: 1.5, provenance: "annotation" }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence out of range — negative", () => {
    const result = SourceMapSchema.safeParse({
      ...validSourceMap,
      mappings: [
        {
          constraint: "c1",
          files: [{ path: "a.ts", confidence: -0.1, provenance: "annotation" }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid provenance enum value", () => {
    const result = SourceMapSchema.safeParse({
      ...validSourceMap,
      mappings: [
        {
          constraint: "c1",
          files: [{ path: "a.ts", confidence: 0.5, provenance: "magic" }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty intent string", () => {
    const result = SourceMapSchema.safeParse({
      ...validSourceMap,
      intent: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid datetime strings for synced_at and last_confirmed", () => {
    const result = SourceMapSchema.safeParse({
      ...validSourceMap,
      synced_at: "2026-04-03T12:00:00.000Z",
      mappings: [
        {
          constraint: "c1",
          files: [
            {
              path: "a.ts",
              confidence: 0.8,
              provenance: "llm-classified",
              last_confirmed: "2026-04-03T11:59:59Z",
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
