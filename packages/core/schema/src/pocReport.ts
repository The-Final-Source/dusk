import { z } from "zod";

/**
 * Greenfield-POC go/no-go evaluation report — Phase 6 design D9 (a v1.x-facing
 * artifact format). Modeled on `DogfoodReport`'s two-section pattern but NOT a
 * reuse of it: `DogfoodReportSchema`'s gating section is `.strict()`-locked to
 * the four dogfood thresholds, and the POC's hard gates differ and are more.
 *
 * The gating section is `.strict()` so no exploratory metric can leak in; the
 * exploratory section is labeled `gating: false` in the artifact itself — the
 * no-blended-metrics rule, enforced structurally. The evaluator that fills this
 * is a zero-model pure pass over `git log` + `traces.jsonl` + `dusk doctor`
 * output (Phase 6 §6.1).
 */

/** A count-style hard gate: an observed count, the threshold it is checked against, and the verdict. */
const gatedCount = (threshold: string) =>
  z
    .object({
      value: z.number().int().min(0),
      threshold: z.literal(threshold),
      pass: z.boolean(),
    })
    .strict();

/** A state-style hard gate (green/red, clean/eroded). */
const gatedState = <V extends string, T extends V>(values: readonly [V, ...V[]], threshold: T) =>
  z
    .object({
      value: z.enum(values as unknown as [V, ...V[]]),
      threshold: z.literal(threshold),
      pass: z.boolean(),
    })
    .strict();

export const PocGatingSchema = z
  .object({
    /** P6-T1 — application-source commits lacking the full v9 trailer set (or not a merge of such). */
    handwritten_application_commit_count: gatedCount("== 0"),
    /** All endpoints landed via `dusk_implement` with mergeable commits — count of endpoints that did NOT. */
    endpoints_not_pipeline_landed: gatedCount("== 0"),
    /** The gate never rejected a legitimate write on the POC. */
    gate_false_positive_count: gatedCount("== 0"),
    /** P6-T2 — intents with no correlating author-role trace + finalize record. */
    intents_not_dialog_authored: gatedCount("== 0"),
    /** P6-T7 — the full pyramid (unit + integration vs live Postgres + e2e vs real HTTP) is green. */
    full_pyramid_on_live_infra: gatedState(["green", "red"] as const, "green"),
    /** P6-T8 — `dusk doctor --static-analysis` is clean in BOTH conservative and `--strict-unknowns` modes. */
    static_analysis_both_modes: gatedState(["clean", "eroded"] as const, "clean"),
    /** All six hard gates pass. */
    pass: z.boolean(),
  })
  .strict();
export type PocGating = z.infer<typeof PocGatingSchema>;

export const PocExploratorySchema = z
  .object({
    gating: z.literal(false),
    /** dialog turn count → number of dialogs with that turn count. */
    dialog_turn_distribution: z.record(z.number().int().min(0)),
    /** Stage-3 proposals accepted as-authored ÷ proposals offered (0–1). */
    stage3_acceptance_rate: z.number().min(0).max(1),
    /** short-cycle iteration count → bead count. */
    iteration_distribution: z.record(z.number().int().min(0)),
    /** Natural pause→author→resume loops that occurred during the build. */
    pause_resume_count: z.number().int().min(0),
    /** Tree-shape stats — recorded, never gated. */
    intent_granularity: z
      .object({
        intent_count: z.number().int().min(0),
        triple_count: z.number().int().min(0),
        mean_triples_per_intent: z.number().min(0),
      })
      .strict(),
    /** Wall-clock from the first build request to each endpoint landing. */
    time_to_endpoint: z.array(z.object({ endpoint: z.string(), ms: z.number().min(0) }).strict()),
    friction_observations: z.array(z.string()),
    /** Friction-driven role/skill edits land as ordinary reviewed commits in the dusk repo; listed for traceability. */
    friction_commits: z.array(z.object({ sha: z.string(), summary: z.string() }).strict()),
  })
  .strict();
export type PocExploratory = z.infer<typeof PocExploratorySchema>;

export const PocReportSchema = z
  .object({
    schema_version: z.literal(1),
    /** The standalone POC repo this report evaluates (path or name). */
    poc_repo: z.string(),
    window: z
      .object({
        initialized_at: z.string(),
        evaluated_at: z.string(),
      })
      .strict(),
    gating: PocGatingSchema,
    exploratory: PocExploratorySchema,
  })
  .strict();
export type PocReport = z.infer<typeof PocReportSchema>;
