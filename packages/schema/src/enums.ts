import { z } from "zod";

export const ObligationSchema = z.enum(["must", "should", "may"]);
export type Obligation = z.infer<typeof ObligationSchema>;

export const VerifiabilitySchema = z.enum(["mechanical", "semantic"]);
export type Verifiability = z.infer<typeof VerifiabilitySchema>;

export const LayerSchema = z.enum([
  "infrastructure",
  "data",
  "api",
  "logic",
  "interaction",
  "presentation",
]);
export type Layer = z.infer<typeof LayerSchema>;

export const RelationshipSchema = z.enum([
  "depends-on",
  "conflicts-with",
  "tension-with",
  "complements",
  "constrains",
]);
export type Relationship = z.infer<typeof RelationshipSchema>;

export const VerdictSchema = z.enum([
  "pass",
  "fail",
  "partial",
  "contested",
  "deferred",
]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const MappingProvenanceSchema = z.enum([
  "annotation",
  "llm-classified",
  "dependency-analysis",
  "path-convention",
  "embedding-similarity",
]);
export type MappingProvenance = z.infer<typeof MappingProvenanceSchema>;

export const AuditDecisionTypeSchema = z.enum([
  "concern_assignment",
  "dedup_merge",
  "stitch_discovered",
  "obligation_inferred",
  "preamble_generated",
  "relevance_ranked",
]);
export type AuditDecisionType = z.infer<typeof AuditDecisionTypeSchema>;

export const AuditDecisionCategorySchema = z.enum(["additive", "destructive"]);
export type AuditDecisionCategory = z.infer<typeof AuditDecisionCategorySchema>;

export const AuditSourceSchema = z.enum([
  "concern_hint",
  "ai-clustered",
  "ai-detected",
  "ai-discovered",
  "ai-inferred",
]);
export type AuditSource = z.infer<typeof AuditSourceSchema>;
