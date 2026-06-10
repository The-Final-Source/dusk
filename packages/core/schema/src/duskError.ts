import { z } from "zod";

/**
 * Uniform error envelope — RFC App. A.11. Every MCP tool returns either its
 * success shape OR a `DuskError`. The full `kind` union is pinned here for
 * forward-compatibility; Phase 2 raises the verification + index kinds.
 */
export const DUSK_ERROR_KINDS = [
  // Pipeline (Phase 3)
  "pipeline_iteration_cap_exceeded",
  "decomposer_intent_unresolved",
  "decomposer_bead_conflict",
  "worktree_creation_failed",
  "merge_conflict_unresolvable",
  "test_runner_command_failed",
  // Pause/resume + recovery (Phase 3)
  "implement_paused_for_authoring",
  "implement_resume_token_expired",
  "bead_intent_revision_needed",
  "bead_frozen",
  "bead_aborted",
  "cancellation_already_committed",
  // Author (Phase 4)
  "author_dialog_id_unknown",
  "author_stage_invalid_response",
  "author_intent_schema_invalid",
  "author_finalize_partial_failure",
  "author_l2_proposal_unreadable",
  // Verifier (Phase 2)
  "verifier_evidence_too_large",
  "verifier_model_call_failed",
  // Index / decoration (Phase 2)
  "intent_path_unresolved",
  "decoration_parse_error",
  // Harness
  "task_tool_call_failed",
  "pretooluse_hook_not_installed",
  "config_invalid",
  // Catch-all
  "internal_error",
] as const;
export const DuskErrorKindSchema = z.enum(DUSK_ERROR_KINDS);
export type DuskErrorKind = z.infer<typeof DuskErrorKindSchema>;

export const DuskErrorSchema = z
  .object({
    schema_version: z.literal(1),
    kind: DuskErrorKindSchema,
    step: z.number().int().min(1).max(9).optional(),
    bead_id: z.string().optional(),
    trace_id: z.string().optional(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    recoverable: z.boolean(),
    recovery_hint: z.string().optional(),
  })
  .strict();
export type DuskError = z.infer<typeof DuskErrorSchema>;

export type DuskErrorOptions = {
  recoverable?: boolean;
  step?: number;
  bead_id?: string;
  trace_id?: string;
  details?: Record<string, unknown>;
  recovery_hint?: string;
};

/** Construct a `DuskError` with `schema_version: 1` and `recoverable` defaulting to false. */
export function duskError(kind: DuskErrorKind, message: string, opts: DuskErrorOptions = {}): DuskError {
  const { recoverable = false, ...rest } = opts;
  return DuskErrorSchema.parse({ schema_version: 1, kind, message, recoverable, ...rest });
}

export function isDuskError(value: unknown): value is DuskError {
  return DuskErrorSchema.safeParse(value).success;
}
