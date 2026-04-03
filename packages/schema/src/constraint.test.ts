import { describe, it, expect } from "vitest";

import { ConstraintSchema } from "./constraint.js";

describe("ConstraintSchema", () => {
  it("accepts a valid constraint with all fields", () => {
    const result = ConstraintSchema.safeParse({
      id: "c-001",
      text: "All API responses must include a request ID header",
      obligation: "must",
      negative: true,
      verifiability: "mechanical",
      concern_hint: "observability",
      refs: ["block-api-headers", "block-logging"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("c-001");
      expect(result.data.negative).toBe(true);
      expect(result.data.verifiability).toBe("mechanical");
      expect(result.data.concern_hint).toBe("observability");
      expect(result.data.refs).toEqual(["block-api-headers", "block-logging"]);
    }
  });

  it("accepts a minimal valid constraint and defaults negative to false", () => {
    const result = ConstraintSchema.safeParse({
      id: "c-002",
      text: "Use structured logging",
      obligation: "should",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.negative).toBe(false);
      expect(result.data.verifiability).toBeUndefined();
      expect(result.data.concern_hint).toBeUndefined();
      expect(result.data.refs).toBeUndefined();
    }
  });

  it("rejects when obligation is missing", () => {
    const result = ConstraintSchema.safeParse({
      id: "c-003",
      text: "Use structured logging",
    });
    expect(result.success).toBe(false);
  });

  it("rejects multi-sentence text", () => {
    const result = ConstraintSchema.safeParse({
      id: "c-004",
      text: "Do X. Then do Y.",
      obligation: "must",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const textError = result.error.issues.find((i) => i.path.includes("text"));
      expect(textError?.message).toBe("Constraint text must be a single sentence");
    }
  });

  it("accepts a single sentence ending with a period", () => {
    const result = ConstraintSchema.safeParse({
      id: "c-005",
      text: "Do X.",
      obligation: "must",
    });
    expect(result.success).toBe(true);
  });

  it("accepts text with abbreviations like e.g.", () => {
    const result = ConstraintSchema.safeParse({
      id: "c-006",
      text: "Use e.g. JWT tokens for authentication",
      obligation: "should",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty id", () => {
    const result = ConstraintSchema.safeParse({
      id: "",
      text: "Use structured logging",
      obligation: "must",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty text", () => {
    const result = ConstraintSchema.safeParse({
      id: "c-008",
      text: "",
      obligation: "must",
    });
    expect(result.success).toBe(false);
  });
});
