import { z } from "zod";

/**
 * Benchmark harness report — Phase 5 design D6/D10 (a v1.x-facing artifact
 * format). Every section is a pure post-pass over one stored run manifest
 * (`verdicts.jsonl` keyed `(fixture_id, model)`) — no fixture is re-run for
 * any report section.
 */

export const FIXTURE_CLASSES = ["mechanical", "static-analysis", "verification", "two-stage-test"] as const;
export const FixtureClassSchema = z.enum(FIXTURE_CLASSES);
export type FixtureClass = z.infer<typeof FixtureClassSchema>;

export const PerClassAccuracySchema = z
  .object({
    class: FixtureClassSchema,
    total: z.number().int().min(0),
    caught: z.number().int().min(0),
    accuracy: z.number().min(0).max(1),
  })
  .strict();
export type PerClassAccuracy = z.infer<typeof PerClassAccuracySchema>;

export const RoleLatencyCostSchema = z
  .object({
    role: z.string(),
    model: z.string(),
    calls: z.number().int().min(0),
    mean_latency_ms: z.number().min(0),
    total_cost_usd: z.number().min(0),
  })
  .strict();
export type RoleLatencyCost = z.infer<typeof RoleLatencyCostSchema>;

/** Cross-model Verifier-verdict agreement: `rates[i][j]` over shared fixtures of `models[i]` × `models[j]`. */
export const AgreementMatrixSchema = z
  .object({
    models: z.array(z.string()),
    rates: z.array(z.array(z.number().min(0).max(1))),
  })
  .strict();
export type AgreementMatrix = z.infer<typeof AgreementMatrixSchema>;

/**
 * P5-T8 — the confirmation-pass flake-rate characterization. Report-only:
 * `gating: false` is a literal so no gate can honestly consume it.
 */
export const FlakeCharacterizationSchema = z
  .object({
    gating: z.literal(false),
    n_first_calls: z.number().int().min(0),
    first_call_reject_rate: z.number().min(0).max(1),
    confirmation_dismissal_rate: z.number().min(0).max(1),
    tolerance_bands: z
      .object({
        first_call_reject: z.tuple([z.number(), z.number()]),
        confirmation_dismissal: z.tuple([z.number(), z.number()]),
      })
      .strict(),
  })
  .strict();
export type FlakeCharacterization = z.infer<typeof FlakeCharacterizationSchema>;

export const BenchmarkReportSchema = z
  .object({
    schema_version: z.literal(1),
    run_id: z.string(),
    generated_at: z.string(),
    models: z.array(z.string()).min(1),
    fixture_count: z.number().int().min(0),
    per_model_per_class_accuracy: z.array(
      z.object({ model: z.string(), classes: z.array(PerClassAccuracySchema) }).strict()
    ),
    per_role_per_model: z.array(RoleLatencyCostSchema),
    agreement_matrix: AgreementMatrixSchema,
    flake_characterization: FlakeCharacterizationSchema.optional(),
  })
  .strict();
export type BenchmarkReport = z.infer<typeof BenchmarkReportSchema>;
