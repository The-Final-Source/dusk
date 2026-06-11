import { z } from "zod";

/**
 * Dogfood go/no-go evaluation report — Phase 5 design D8/D10 (a v1.x-facing
 * artifact format). The gating section carries EXACTLY the four named
 * thresholds (`.strict()` enforces that no exploratory metric can appear
 * there); the exploratory section is labeled `gating: false` in the artifact
 * itself — the no-blended-metrics rule, enforced structurally.
 */

const gatedCount = (threshold: string) =>
  z
    .object({
      value: z.number().int().min(0),
      threshold: z.literal(threshold),
      pass: z.boolean(),
    })
    .strict();

export const DogfoodGatingSchema = z
  .object({
    /** ≥1 end-to-end `dusk_implement` producing a mergeable commit with full v9 trailers. */
    e2e_implement_success_count: gatedCount(">= 1"),
    /** The gate never rejected a legitimate write on the decorated package. */
    gate_false_positive_count: gatedCount("== 0"),
    worked_example_regression: z
      .object({
        value: z.enum(["clean", "regressed"]),
        threshold: z.literal("clean"),
        pass: z.boolean(),
      })
      .strict(),
    package_test_suite: z
      .object({
        value: z.enum(["green", "red"]),
        threshold: z.literal("green"),
        pass: z.boolean(),
      })
      .strict(),
    /** All four thresholds pass. */
    pass: z.boolean(),
  })
  .strict();
export type DogfoodGating = z.infer<typeof DogfoodGatingSchema>;

export const DogfoodExploratorySchema = z
  .object({
    gating: z.literal(false),
    /** short-cycle iteration count → bead count. */
    iteration_distribution: z.record(z.number().int().min(0)),
    /** author dialog branch count → dialog count. */
    author_branching_distribution: z.record(z.number().int().min(0)),
    stuckness_fire_count: z.number().int().min(0),
    livelock_count: z.number().int().min(0),
    doctor_finding_trend: z.array(
      z.object({ at: z.string(), findings: z.number().int().min(0) }).strict()
    ),
    /** v1.x on-ramp — recorded here, never gated. */
    api_expansion: z.object({ begun: z.boolean(), notes: z.string() }).strict(),
    friction_observations: z.array(z.string()),
    /** Friction-driven role/skill edits land as ordinary reviewed commits; listed for traceability. */
    friction_commits: z.array(z.object({ sha: z.string(), summary: z.string() }).strict()),
  })
  .strict();
export type DogfoodExploratory = z.infer<typeof DogfoodExploratorySchema>;

export const DogfoodReportSchema = z
  .object({
    schema_version: z.literal(1),
    package: z.string(),
    window: z
      .object({
        first_decorated_commit_at: z.string(),
        evaluated_at: z.string(),
        days: z.number().min(0),
      })
      .strict(),
    gating: DogfoodGatingSchema,
    exploratory: DogfoodExploratorySchema,
  })
  .strict();
export type DogfoodReport = z.infer<typeof DogfoodReportSchema>;
