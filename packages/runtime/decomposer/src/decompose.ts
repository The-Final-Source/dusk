import type { DerivedIndex } from "@dusk/core-index";
import {
  DEFAULT_TEST_PYRAMID_SUFFIXES,
  duskError,
  err,
  ok,
  type ImplementCheckpoint,
  type RuntimeResult,
  type SupportOverlapWarning,
  type BeadDag,
} from "@dusk/core-schema";
import { newResumeToken, suggestedDialogSeed, writeCheckpoint } from "@dusk/runtime-implement-checkpoint";

import { buildBeadDag, type Clock } from "./dag.js";
import { walkRelatesTo } from "./walk.js";

/**
 * Step-1+2 entry point. Identifies directly-touched intents, walks the typed
 * graph, escalates an unresolved reference to a checkpoint pause (P3-T5), refuses
 * `conflicts` / focal-overlap pairs (P3-T2/T4), and otherwise issues the bead DAG
 * (P3-T3). All conflict detection precedes any worktree creation (the DAG is the
 * Step-2 output; Step 3 only runs on success).
 */

export type DecomposeInput = {
  /** Cross-bead snapshot index (the frozen base; bead deltas excluded). */
  index: DerivedIndex;
  clock: Clock;
  rootDir: string;
  request: string;
  scopeHint?: string[];
  suffixes?: string[];
  beadIdSeqStart?: number;
  /** Sequence number for the resume token minted on an unresolved-intent pause. */
  resumeTokenSeq?: number;
};

export type DecomposeOutput = {
  dag: BeadDag;
  warnings: SupportOverlapWarning[];
  beadForIntent: Record<string, string>;
  seeds: string[];
  activeIntents: string[];
};

/**
 * Identify directly-touched intents deterministically: an explicit `scope_hint`
 * wins; otherwise match intents whose path (or last segment) appears in the
 * request text. (Phase 3 keeps this deterministic; a model-driven identifier is
 * a later refinement that doesn't change the contract.)
 */
export function identifyTouchedIntents(request: string, scopeHint: string[] | undefined, index: DerivedIndex): string[] {
  if (scopeHint && scopeHint.length > 0) return [...new Set(scopeHint)];
  const lower = request.toLowerCase();
  const matched = [...index.intents.keys()].filter((id) => {
    const last = id.split("/").at(-1) ?? id;
    return lower.includes(id.toLowerCase()) || lower.includes(last.toLowerCase());
  });
  return [...new Set(matched)];
}

const iso = (clock: Clock): string => new Date(clock.now()).toISOString();

export function decompose(input: DecomposeInput): RuntimeResult<DecomposeOutput> {
  const suffixes = input.suffixes ?? [...DEFAULT_TEST_PYRAMID_SUFFIXES];
  const seeds = identifyTouchedIntents(input.request, input.scopeHint, input.index);

  if (seeds.length === 0) {
    return err(
      duskError("decomposer_intent_unresolved", "the request did not resolve to any authored intent", {
        recoverable: true,
        step: 1,
        recovery_hint: "pass an explicit scope_hint of intent paths, or author the intents the request refers to",
      }),
    );
  }

  const walk = walkRelatesTo(seeds, input.index, suffixes);

  // 5.3 — unresolved intent reference → checkpoint pause (resumable).
  if (walk.unresolvedRefs.length > 0) {
    const token = newResumeToken(input.clock, input.resumeTokenSeq ?? 1);
    const checkpoint: ImplementCheckpoint = {
      schema_version: 1,
      original_request: input.request,
      ...(input.scopeHint ? { scope_hint: input.scopeHint } : {}),
      decomposer_partial_state: {
        active_intents: walk.activeIntents,
        edges: walk.typedEdges.map((e) => ({ from: e.fromIntent, to: e.toIntent, kind: e.kind })),
      },
      intents_resolved_so_far: walk.activeIntents,
      intents_still_unresolved: walk.unresolvedRefs,
      suggested_dialog_seed: suggestedDialogSeed(walk.unresolvedRefs),
      unresolved_refs: walk.unresolvedRefs,
      created_at: iso(input.clock),
      last_touched_at: iso(input.clock),
    };
    writeCheckpoint(input.rootDir, token, checkpoint);
    return err(
      duskError("implement_paused_for_authoring", `unresolved intent reference(s): ${walk.unresolvedRefs.join(", ")}`, {
        recoverable: true,
        step: 1,
        details: {
          resume_token: token,
          unresolved_refs: walk.unresolvedRefs,
          suggested_dialog_seed: suggestedDialogSeed(walk.unresolvedRefs),
        },
        recovery_hint: `author the missing intents, then dusk_implement({resume_token: "${token}"})`,
      }),
    );
  }

  // 5.1 — `conflicts` relation where both endpoints are active → hard refusal.
  if (walk.conflict) {
    return err(
      duskError("decomposer_bead_conflict", `intents "${walk.conflict.a}" and "${walk.conflict.b}" conflict`, {
        recoverable: false,
        step: 1,
        details: { intent_a: walk.conflict.a, intent_b: walk.conflict.b },
      }),
    );
  }

  // 5.2 — bead DAG (file-overlap + claim-overlap precondition). May hard-refuse.
  const dag = buildBeadDag(walk, input.index, input.clock, input.beadIdSeqStart ?? 1);
  if (!dag.success) return dag;

  return ok({
    dag: dag.value.dag,
    warnings: dag.value.warnings,
    beadForIntent: dag.value.beadForIntent,
    seeds,
    activeIntents: walk.activeIntents,
  });
}
