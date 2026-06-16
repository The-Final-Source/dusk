import { z } from "zod";

import { ComposeRuleSchema, ObligationSchema, TripleSchema } from "./primitives.js";
import { FailingTripleSchema, LivelockResolutionVerbSchema } from "./livelockReport.js";
import { DIALOG_ID_RE } from "./ids.js";

/**
 * Phase-4 frozen cross-proposal seams (design D2/D9). `DialogState` is the
 * disk-persisted dialog shape Phase 5's audit reads to inspect human-Author
 * negotiation transcripts. It lives here in the leaf (NOT in `runtime/author`)
 * so Phase 5 imports it without inverting the dep graph.
 */

/** The 5-stage continuation flow plus the synchronous 4.5 validation pass (RFC §5). */
export const AUTHOR_STAGES = [1, 2, 3, 4, "4.5", 5] as const;
export const AuthorStageSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal("4.5"),
  z.literal(5),
]);
export type AuthorStage = z.infer<typeof AuthorStageSchema>;

/** Entry modes for `dusk_author_start` (design D5/D6/D9). */
export const AUTHOR_ENTRY_MODES = ["full", "scoped_triple_edit", "l2_recovery"] as const;
export const AuthorEntryModeSchema = z.enum(AUTHOR_ENTRY_MODES);
export type AuthorEntryMode = z.infer<typeof AuthorEntryModeSchema>;

export const TranscriptEntrySchema = z
  .object({
    role: z.enum(["author", "user"]),
    content: z.string(),
    stage: AuthorStageSchema,
    at: z.string(),
  })
  .strict();
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

/**
 * Tension classification vocabulary for Stage 2 discovery (RFC §5 Stage 2;
 * design Q1; App. D.25). Tensions are surfaced in BOTH directions: against
 * intents that EXIST (conflict/overlap/gray/adjacent) and against an intent the
 * request depends on but that does NOT exist yet (`prerequisite`). The latter is
 * fully general — the greenfield foundation (project/stack, bootstrap,
 * persistence not yet authored) is the canonical instance, not a special case;
 * it carries no bootstrap state into the flow. A `prerequisite` tension is a
 * normal non-empty surfaced finding, so the existing "zero tensions → advance"
 * path naturally keeps it visible for a user decision.
 */
export const TENSION_CLASSIFICATIONS = ["conflict", "overlap", "gray", "adjacent", "prerequisite"] as const;
export const TensionClassificationSchema = z.enum(TENSION_CLASSIFICATIONS);
export type TensionClassification = z.infer<typeof TensionClassificationSchema>;

export const TensionResolutionSchema = z
  .object({
    target: z.string().min(1),
    classification: TensionClassificationSchema,
    resolution: z.string().min(1),
  })
  .strict();
export type TensionResolution = z.infer<typeof TensionResolutionSchema>;

/** A surfaced-but-unresolved tension (the Stage-2 classifier output). */
export const TensionFindingSchema = z
  .object({
    target: z.string().min(1),
    classification: TensionClassificationSchema,
    excerpt: z.string().optional(),
    resolution_options: z.array(z.string()).default([]),
  })
  .strict();
export type TensionFinding = z.infer<typeof TensionFindingSchema>;

/** In-place edit marker for `scoped_triple_edit` dialogs: Stage 5 writes the edited
 *  triple back into the existing intent file (NO new intent is created). */
export const InPlaceEditSchema = z
  .object({
    target_intent_path: z.string().min(1),
    triple_id: z.string().min(1),
  })
  .strict();
export type InPlaceEdit = z.infer<typeof InPlaceEditSchema>;

/**
 * Relaxed draft sub-shapes. `intents_drafted[]` accumulates the in-progress draft
 * and is ONLY schema-validated at Stage 4.5 — a draft must be able to carry the
 * very violations 4.5 bounces (a matrix-negated predicate, an out-of-vocabulary
 * antecedent predicate, a `refines` relates_to kind), so the draft shapes do NOT
 * enforce the closed vocabularies the parser primitives enforce at 4.5.
 */
export const DraftAntecedentSchema = z
  .object({
    id: z.string().min(1),
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
    polarity: z.enum(["positive", "negative"]).optional(),
  })
  .strict();
export type DraftAntecedent = z.infer<typeof DraftAntecedentSchema>;

export const DraftRelatesToSchema = z
  .object({
    kind: z.string().min(1),
    target: z.string().min(1),
  })
  .strict();
export type DraftRelatesTo = z.infer<typeof DraftRelatesToSchema>;

export const DraftIntentSchema = z
  .object({
    schema_version: z.literal(2).optional(),
    id: z.string().optional(),
    description: z.string().optional(),
    obligation: ObligationSchema.optional(),
    compose: ComposeRuleSchema.optional(),
    triples: z.array(TripleSchema).optional(),
    antecedent: z.array(DraftAntecedentSchema).optional(),
    consequent: z.array(TripleSchema).optional(),
    relates_to: z.array(DraftRelatesToSchema).optional(),
    // ---- Author bookkeeping (stripped before Stage-5 write; audit-readable). ----
    /** Stage-2 surfaced tensions awaiting the user's resolution pick. */
    tensions_surfaced: z.array(TensionFindingSchema).optional(),
    /** Stage-2 resolution picks encoded into the drafted set (RFC §5 Stage 2). */
    tension_resolutions: z.array(TensionResolutionSchema).optional(),
    /** Stage-3 accepted practice proposal carried into Stage-4 drafting (absent = greenfield). */
    practice_scaffold: z.string().optional(),
    /** Stage-4 pyramid pick (the user-chosen subset of test-pyramid layers). */
    pyramid_picked: z.array(z.string()).optional(),
    /** Stage-4 reciprocal-edge proposal answered (confirmed or declined). */
    reciprocal_resolved: z.boolean().optional(),
    /** `scoped_triple_edit` dialogs: finalize writes back in-place instead of creating. */
    in_place_edit: InPlaceEditSchema.optional(),
  })
  .strict();
export type DraftIntent = z.infer<typeof DraftIntentSchema>;

export const DialogStateSchema = z
  .object({
    schema_version: z.literal(1),
    dialog_id: z.string().regex(DIALOG_ID_RE, "dialog_id must match dlg_<14-digit-ts><3-digit-seq>"),
    request: z.string(),
    current_stage: AuthorStageSchema,
    transcript: z.array(TranscriptEntrySchema),
    intents_drafted: z.array(DraftIntentSchema),
    created_at: z.string(),
    last_touched_at: z.string(),
  })
  .strict();
export type DialogState = z.infer<typeof DialogStateSchema>;

/**
 * `dialog_init` carries entry-mode seeds on `dusk_author_start` and the REWIRED
 * `dusk_resolve_livelock` (design D9: the Phase-3 `payload` parameter is removed;
 * `dialog_init?` replaces it).
 */
export const DialogInitSchema = z
  .object({
    /** `scoped_triple_edit`: the failing triple from `TestVerifierLivelockReport`. */
    failing_triple: FailingTripleSchema.optional(),
    /** `scoped_triple_edit`: the intent file the edited triple writes back into. */
    target_intent_path: z.string().optional(),
    /** `scoped_triple_edit`: the id of the triple being replaced in-place. */
    failing_triple_id: z.string().optional(),
    /** `l2_recovery`: path to the bead's `intent-proposal.yaml`. */
    proposal_path: z.string().optional(),
  })
  .strict();
export type DialogInit = z.infer<typeof DialogInitSchema>;

/** The rewired `dusk_resolve_livelock` call shape (design D9). `payload` is GONE. */
export const ResolveLivelockRequestSchema = z
  .object({
    bead_id: z.string(),
    verb: LivelockResolutionVerbSchema,
    dialog_init: DialogInitSchema.optional(),
  })
  .strict();
export type ResolveLivelockRequest = z.infer<typeof ResolveLivelockRequestSchema>;
