import { z } from "zod";

/**
 * The pause/resume checkpoint — RFC §10.1.1; design D4. This shape is the FROZEN
 * cross-proposal interface: Phase 4's Author package imports it directly (so it
 * lives here in the leaf, not in `runtime/implement-checkpoint`, to keep the dep
 * graph acyclic). Phase 3 ships `suggested_dialog_seed` as the naive
 * `unresolved_refs.join(", ")` (typed-correct, content-naive); Phase 4 enriches
 * the *content* without changing the *shape*.
 */

/**
 * Opaque-to-Phase-4 Decomposer state carried inside the checkpoint. Phase 3 owns
 * the shape; Phase 4 round-trips it verbatim (hence `passthrough`).
 */
export const DecomposerEdgeSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    kind: z.string(),
  })
  .strict();
export type DecomposerEdge = z.infer<typeof DecomposerEdgeSchema>;

export const DecomposerPartialStateSchema = z
  .object({
    active_intents: z.array(z.string()).default([]),
    edges: z.array(DecomposerEdgeSchema).default([]),
  })
  .passthrough();
export type DecomposerPartialState = z.infer<typeof DecomposerPartialStateSchema>;

export const ImplementCheckpointSchema = z
  .object({
    schema_version: z.literal(1),
    original_request: z.string(),
    scope_hint: z.array(z.string()).optional(),
    decomposer_partial_state: DecomposerPartialStateSchema,
    intents_resolved_so_far: z.array(z.string()),
    intents_still_unresolved: z.array(z.string()),
    /** Phase 3: naive `unresolved_refs.join(", ")`; Phase 4 enriches content only. */
    suggested_dialog_seed: z.string(),
    unresolved_refs: z.array(z.string()),
    created_at: z.string(),
    last_touched_at: z.string(),
  })
  .strict();
export type ImplementCheckpoint = z.infer<typeof ImplementCheckpointSchema>;
