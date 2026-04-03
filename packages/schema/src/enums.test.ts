import { describe, it, expect } from "vitest";

import {
  ObligationSchema,
  VerifiabilitySchema,
  LayerSchema,
  RelationshipSchema,
  VerdictSchema,
  MappingProvenanceSchema,
  AuditDecisionTypeSchema,
  AuditDecisionCategorySchema,
  AuditSourceSchema,
} from "./enums.js";

describe("ObligationSchema", () => {
  it.each(["must", "should", "may"])("accepts '%s'", (value) => {
    expect(ObligationSchema.safeParse(value).success).toBe(true);
  });

  it("rejects invalid value", () => {
    expect(ObligationSchema.safeParse("required").success).toBe(false);
  });
});

describe("VerifiabilitySchema", () => {
  it.each(["mechanical", "semantic"])("accepts '%s'", (value) => {
    expect(VerifiabilitySchema.safeParse(value).success).toBe(true);
  });

  it("rejects invalid value", () => {
    expect(VerifiabilitySchema.safeParse("automatic").success).toBe(false);
  });
});

describe("LayerSchema", () => {
  it.each([
    "infrastructure",
    "data",
    "api",
    "logic",
    "interaction",
    "presentation",
  ])("accepts '%s'", (value) => {
    expect(LayerSchema.safeParse(value).success).toBe(true);
  });

  it("rejects invalid value", () => {
    expect(LayerSchema.safeParse("frontend").success).toBe(false);
  });
});

describe("RelationshipSchema", () => {
  it.each([
    "depends-on",
    "conflicts-with",
    "tension-with",
    "complements",
    "constrains",
  ])("accepts '%s'", (value) => {
    expect(RelationshipSchema.safeParse(value).success).toBe(true);
  });

  it("rejects invalid value", () => {
    expect(RelationshipSchema.safeParse("related-to").success).toBe(false);
  });
});

describe("VerdictSchema", () => {
  it.each(["pass", "fail", "partial", "contested", "deferred"])(
    "accepts '%s'",
    (value) => {
      expect(VerdictSchema.safeParse(value).success).toBe(true);
    },
  );

  it("rejects invalid value", () => {
    expect(VerdictSchema.safeParse("success").success).toBe(false);
  });
});

describe("MappingProvenanceSchema", () => {
  it.each([
    "annotation",
    "llm-classified",
    "dependency-analysis",
    "path-convention",
    "embedding-similarity",
  ])("accepts '%s'", (value) => {
    expect(MappingProvenanceSchema.safeParse(value).success).toBe(true);
  });

  it("rejects invalid value", () => {
    expect(MappingProvenanceSchema.safeParse("manual").success).toBe(false);
  });
});

describe("AuditDecisionTypeSchema", () => {
  it.each([
    "concern_assignment",
    "dedup_merge",
    "stitch_discovered",
    "obligation_inferred",
    "preamble_generated",
    "relevance_ranked",
  ])("accepts '%s'", (value) => {
    expect(AuditDecisionTypeSchema.safeParse(value).success).toBe(true);
  });

  it("rejects invalid value", () => {
    expect(AuditDecisionTypeSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("AuditDecisionCategorySchema", () => {
  it.each(["additive", "destructive"])("accepts '%s'", (value) => {
    expect(AuditDecisionCategorySchema.safeParse(value).success).toBe(true);
  });

  it("rejects invalid value", () => {
    expect(AuditDecisionCategorySchema.safeParse("neutral").success).toBe(
      false,
    );
  });
});

describe("AuditSourceSchema", () => {
  it.each([
    "concern_hint",
    "ai-clustered",
    "ai-detected",
    "ai-discovered",
    "ai-inferred",
  ])("accepts '%s'", (value) => {
    expect(AuditSourceSchema.safeParse(value).success).toBe(true);
  });

  it("rejects invalid value", () => {
    expect(AuditSourceSchema.safeParse("user-defined").success).toBe(false);
  });
});
