import { z } from "zod";

/**
 * Static-analysis doctor report — Phase 5 design D5/D10 (a v1.x-facing
 * artifact format). `S ⊄ D` decoration-erosion findings (conservative
 * default), the `--strict-unknowns` `undecorated_callee` class, the
 * conflicts-pair co-decoration flag, and the per-file decoration-density
 * baseline for drift trending.
 */

export const STATIC_FINDING_CLASSES = [
  "s_not_subset_d",
  "undecorated_callee",
  "conflicts_co_decoration",
] as const;
export const StaticFindingClassSchema = z.enum(STATIC_FINDING_CLASSES);
export type StaticFindingClass = z.infer<typeof StaticFindingClassSchema>;

export const StaticFindingSchema = z
  .object({
    class: StaticFindingClassSchema,
    file: z.string(),
    line: z.number().int().min(1),
    intents_involved: z.array(z.string()),
    suggestion: z.string(),
    severity: z.enum(["error", "warning", "info"]),
  })
  .strict();
export type StaticFinding = z.infer<typeof StaticFindingSchema>;

export const DensityEntrySchema = z
  .object({
    file: z.string(),
    decorated_units: z.number().int().min(0),
    undecorated_units: z.number().int().min(0),
  })
  .strict();
export type DensityEntry = z.infer<typeof DensityEntrySchema>;

export const StaticAnalysisReportSchema = z
  .object({
    schema_version: z.literal(1),
    generated_at: z.string(),
    mode: z.enum(["conservative", "strict-unknowns"]),
    findings: z.array(StaticFindingSchema),
    /** Decorated-vs-undecorated unit counts per file — the drift-trending baseline. */
    density_baseline: z.array(DensityEntrySchema),
  })
  .strict();
export type StaticAnalysisReport = z.infer<typeof StaticAnalysisReportSchema>;
