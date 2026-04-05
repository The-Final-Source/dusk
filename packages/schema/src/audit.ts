import { z } from "zod";

import {
  AuditDecisionTypeSchema,
  AuditDecisionCategorySchema,
  AuditSourceSchema,
} from "./enums.js";

const semverRegex = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/;

export const AuditDecisionSchema = z.object({
  type: AuditDecisionTypeSchema,
  category: AuditDecisionCategorySchema,
  source: AuditSourceSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

export const CompositionAuditSchema = z.object({
  intent: z.string().min(1),
  composed_at: z.string().datetime(),
  composition_version: z
    .string()
    .regex(semverRegex, "composition_version must be valid semver"),
  decisions: z.array(AuditDecisionSchema),
});

export type AuditDecision = z.infer<typeof AuditDecisionSchema>;
export type CompositionAudit = z.infer<typeof CompositionAuditSchema>;
