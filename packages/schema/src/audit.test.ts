import { describe, it, expect } from "vitest";

import { AuditDecisionSchema, CompositionAuditSchema } from "./audit.js";

const validDecision = {
  type: "concern_assignment" as const,
  category: "additive" as const,
  source: "ai-clustered" as const,
  confidence: 0.85,
  rationale: "Assigned concern based on clustering analysis",
};

const validAudit = {
  intent: "todo-app",
  composed_at: "2026-04-03T12:00:00Z",
  composition_version: "1.0.0",
  decisions: [validDecision],
};

describe("AuditDecisionSchema", () => {
  it("accepts a valid decision with complete fields", () => {
    expect(AuditDecisionSchema.safeParse(validDecision).success).toBe(true);
  });

  it("rejects invalid decision type", () => {
    expect(
      AuditDecisionSchema.safeParse({ ...validDecision, type: "invalid_type" })
        .success,
    ).toBe(false);
  });

  it("rejects invalid category", () => {
    expect(
      AuditDecisionSchema.safeParse({
        ...validDecision,
        category: "neutral",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid source", () => {
    expect(
      AuditDecisionSchema.safeParse({ ...validDecision, source: "manual" })
        .success,
    ).toBe(false);
  });

  it.each([1.5, -0.1])("rejects confidence out of range (%s)", (value) => {
    expect(
      AuditDecisionSchema.safeParse({ ...validDecision, confidence: value })
        .success,
    ).toBe(false);
  });

  it("rejects empty rationale", () => {
    expect(
      AuditDecisionSchema.safeParse({ ...validDecision, rationale: "" })
        .success,
    ).toBe(false);
  });

  it("distinguishes additive from destructive categories", () => {
    const additive = AuditDecisionSchema.safeParse({
      ...validDecision,
      category: "additive",
    });
    const destructive = AuditDecisionSchema.safeParse({
      ...validDecision,
      category: "destructive",
    });

    expect(additive.success).toBe(true);
    expect(destructive.success).toBe(true);

    if (additive.success && destructive.success) {
      expect(additive.data.category).toBe("additive");
      expect(destructive.data.category).toBe("destructive");
    }
  });
});

describe("CompositionAuditSchema", () => {
  it("accepts a valid audit with complete fields", () => {
    expect(CompositionAuditSchema.safeParse(validAudit).success).toBe(true);
  });

  it.each(["abc", "1.2"])(
    "rejects invalid semver for composition_version ('%s')",
    (value) => {
      expect(
        CompositionAuditSchema.safeParse({
          ...validAudit,
          composition_version: value,
        }).success,
      ).toBe(false);
    },
  );

  it("accepts valid semver with pre-release tag", () => {
    expect(
      CompositionAuditSchema.safeParse({
        ...validAudit,
        composition_version: "1.0.0-alpha",
      }).success,
    ).toBe(true);
  });
});
