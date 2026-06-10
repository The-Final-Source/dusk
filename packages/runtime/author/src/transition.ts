import {
  DEFAULT_TEST_PYRAMID_SUFFIXES,
  type AuthorStage,
  type DialogState,
  type DraftIntent,
  type TensionResolution,
  type Triple,
} from "@dusk/core-schema";

import { validateDrafts, type DraftViolation } from "./validateDraft.js";

/**
 * The pure 5-stage transition function (design D1). No I/O, no clock, no model:
 * `(state, response) → { nextState, outcome }`. The runtime wraps it with the
 * generator call (LLM or scripted) and persistence. Every branching decision is
 * a first-class transition — Stage-1 loopback, Stage-2 tension picks, Stage-3
 * greenfield rejection, Stage-4 pyramid/reciprocal/confirm, Stage-4.5 bounce.
 */

export type UserResponseKind =
  | "confirm_framing"
  | "reject_framing"
  | "resolve_tensions"
  | "accept_practice_proposal"
  | "selective_accept"
  | "reject_practice_proposal"
  | "pick_pyramid_layers"
  | "confirm_reciprocal"
  | "decline_reciprocal"
  | "revise_draft"
  | "confirm_draft"
  | "noop";

export type ClassifiedResponse = {
  kind: UserResponseKind;
  text: string;
  payload?: Record<string, unknown>;
  /** Clock-injected ISO timestamp (the transition itself is clockless). */
  at: string;
};

export type SkillHint = "polarity-decision" | "implies-antecedent-grammar" | "typed-relates-to";

export type QuestionSpec =
  | { type: "framing" }
  | { type: "framing_regenerated" }
  | { type: "tension_resolution" }
  | { type: "practice_proposal" }
  | { type: "draft_with_pyramid"; greenfield: boolean }
  | { type: "draft_revision" }
  | { type: "reciprocal_edge"; source: string; target: string }
  | { type: "draft_confirmation" }
  | { type: "stage45_bounce"; violation: DraftViolation }
  | { type: "scoped_triple_edit" };

export type TransitionOutcome = { kind: "ask"; stage: AuthorStage; question: QuestionSpec } | { kind: "finalize_ready" };

export type TransitionOptions = {
  pyramidSuffixes?: string[];
};

const isPyramidChild = (id: string | undefined, suffixes: string[]): boolean =>
  id !== undefined && suffixes.includes(id.split("/").at(-1) ?? "");

/** The draft the Stage-4 sub-steps revolve around (the implementation intent). */
export function implDraft(state: DialogState, suffixes: string[] = [...DEFAULT_TEST_PYRAMID_SUFFIXES]): DraftIntent | undefined {
  return state.intents_drafted.find((d) => d.triples !== undefined && !isPyramidChild(d.id, suffixes) && d.in_place_edit === undefined);
}

const scopedDraft = (state: DialogState): DraftIntent | undefined => state.intents_drafted.find((d) => d.in_place_edit !== undefined);

/** The first draft slot (Stage-2 scaffold), created on demand. */
function withScaffold(state: DialogState, mutate: (scaffold: DraftIntent) => DraftIntent): DialogState {
  const drafts = [...state.intents_drafted];
  if (drafts.length === 0) drafts.push({});
  drafts[0] = mutate(drafts[0]);
  return { ...state, intents_drafted: drafts };
}

const appendUserTurn = (state: DialogState, response: ClassifiedResponse): DialogState => ({
  ...state,
  transcript: [...state.transcript, { role: "user", content: response.text, stage: state.current_stage, at: response.at }],
});

/** The accepted Stage-3 proposal text (the most recent author turn at Stage 3). */
const lastAuthorTurnAt = (state: DialogState, stage: AuthorStage): string | undefined =>
  [...state.transcript].reverse().find((t) => t.role === "author" && t.stage === stage)?.content;

const ask = (stage: AuthorStage, question: QuestionSpec): TransitionOutcome => ({ kind: "ask", stage, question });

/** Whether an unresolved reciprocal-edge proposal is pending on the impl draft. */
export function reciprocalPending(state: DialogState, suffixes: string[] = [...DEFAULT_TEST_PYRAMID_SUFFIXES]): { source: string; target: string } | null {
  const impl = implDraft(state, suffixes);
  if (!impl || impl.reciprocal_resolved) return null;
  if (impl.pyramid_picked === undefined) return null; // reciprocal question follows the pyramid pick
  const edge = (impl.relates_to ?? []).find((r) => r.kind === "implies");
  return edge ? { source: impl.id ?? "(draft)", target: edge.target } : null;
}

export function transition(state: DialogState, response: ClassifiedResponse, options: TransitionOptions = {}): { nextState: DialogState; outcome: TransitionOutcome } {
  const suffixes = options.pyramidSuffixes ?? [...DEFAULT_TEST_PYRAMID_SUFFIXES];
  let next = appendUserTurn(state, response);

  switch (state.current_stage) {
    case 1: {
      if (response.kind === "confirm_framing") {
        next = { ...next, current_stage: 2 };
        return { nextState: next, outcome: ask(2, { type: "tension_resolution" }) };
      }
      // Loopback (P4-T11): any correction stays at Stage 1 with a regenerated framing.
      return { nextState: next, outcome: ask(1, { type: "framing_regenerated" }) };
    }

    case 2: {
      const surfaced = next.intents_drafted[0]?.tensions_surfaced ?? [];
      const rawPicks = Array.isArray(response.payload?.resolutions) ? (response.payload.resolutions as Array<{ target?: string; resolution?: string }>) : undefined;
      const resolutions: TensionResolution[] = (rawPicks ?? surfaced.map((t) => ({ target: t.target, resolution: response.text }))).map((pick) => {
        const finding = surfaced.find((t) => t.target === pick.target);
        return {
          target: pick.target ?? "(unspecified)",
          classification: finding?.classification ?? "overlap",
          resolution: pick.resolution ?? response.text,
        };
      });
      if (resolutions.length > 0) {
        next = withScaffold(next, (s) => ({ ...s, tension_resolutions: [...(s.tension_resolutions ?? []), ...resolutions] }));
      }
      next = { ...next, current_stage: 3 };
      return { nextState: next, outcome: ask(3, { type: "practice_proposal" }) };
    }

    case 3: {
      if (response.kind === "reject_practice_proposal") {
        // Greenfield (P4-T12): NO scaffold — Stage 4 drafts from the Stage-1 framing alone.
        next = { ...next, current_stage: 4 };
        return { nextState: next, outcome: ask(4, { type: "draft_with_pyramid", greenfield: true }) };
      }
      const proposal = lastAuthorTurnAt(state, 3) ?? "";
      const scaffold = response.kind === "selective_accept" ? `${proposal}\n\n[selectively accepted]: ${response.text}` : proposal;
      next = withScaffold(next, (s) => ({ ...s, practice_scaffold: scaffold }));
      next = { ...next, current_stage: 4 };
      return { nextState: next, outcome: ask(4, { type: "draft_with_pyramid", greenfield: false }) };
    }

    case 4:
    case "4.5": {
      const scoped = scopedDraft(next);

      if (response.kind === "pick_pyramid_layers") {
        const layers = Array.isArray(response.payload?.layers) ? (response.payload.layers as string[]) : [];
        const impl = implDraft(next, suffixes);
        if (impl?.id) {
          const children = layers.filter((l) => suffixes.includes(l)).map((layer) => pyramidChild(impl, layer));
          const drafts = next.intents_drafted.map((d) => (d === impl ? { ...d, pyramid_picked: layers } : d));
          next = { ...next, intents_drafted: [...drafts, ...children] };
        }
        const pending = reciprocalPending(next, suffixes);
        if (pending) return { nextState: next, outcome: ask(4, { type: "reciprocal_edge", ...pending }) };
        return { nextState: next, outcome: ask(4, { type: "draft_confirmation" }) };
      }

      if (response.kind === "confirm_reciprocal" || response.kind === "decline_reciprocal") {
        next = {
          ...next,
          intents_drafted: next.intents_drafted.map((d) => (d === implDraft(next, suffixes) ? { ...d, reciprocal_resolved: true } : d)),
        };
        return { nextState: next, outcome: ask(4, { type: "draft_confirmation" }) };
      }

      if (response.kind === "revise_draft") {
        // Mechanical in-place triple edit (scoped_triple_edit dialogs).
        const edited = response.payload?.edited_triple as Triple | undefined;
        if (scoped && edited && scoped.in_place_edit) {
          const tripleId = scoped.in_place_edit.triple_id;
          next = {
            ...next,
            intents_drafted: next.intents_drafted.map((d) =>
              d === scoped
                ? { ...d, triples: (d.triples ?? []).map((t) => (t.id === tripleId ? { ...edited, id: tripleId } : t)) }
                : d,
            ),
          };
          return { nextState: next, outcome: ask(4, { type: "draft_confirmation" }) };
        }
        // Free-form revision: the runtime re-invokes the generator for a revised draft.
        return { nextState: next, outcome: ask(4, { type: "draft_revision" }) };
      }

      if (response.kind === "confirm_draft") {
        // ---- Stage 4.5: synchronous pre-commit validation (design D3). ----
        const violations = validateDrafts(next.intents_drafted);
        if (violations.length > 0) {
          // Bounce back to Stage 4; the offending draft is preserved for revision.
          next = { ...next, current_stage: 4 };
          return { nextState: next, outcome: ask(4, { type: "stage45_bounce", violation: violations[0] }) };
        }
        next = { ...next, current_stage: 5 };
        return { nextState: next, outcome: { kind: "finalize_ready" } };
      }

      // Anything else at Stage 4 is a revision request routed through the generator.
      return { nextState: next, outcome: ask(4, { type: "draft_revision" }) };
    }

    case 5:
      return { nextState: next, outcome: { kind: "finalize_ready" } };
  }
}

/** Canonical test-pyramid child for a picked layer (RFC §3.4; P4-T3). */
export function pyramidChild(impl: DraftIntent, layer: string): DraftIntent {
  const layerNoun = layer.replace(/-tests$/, "");
  const triples = (impl.triples ?? []).map((t) => ({
    id: `covers-${t.id}`,
    subject: `the ${layerNoun} test`,
    predicate: "verifies",
    object: t.polarity === "negative" ? `that ${t.subject} does not ${t.predicate} ${t.object}` : `that ${t.subject} ${t.predicate} ${t.object}`,
    polarity: "positive" as const,
  }));
  return {
    id: `${impl.id}/${layer}`,
    description: `${layerNoun[0].toUpperCase()}${layerNoun.slice(1)} tests cover ${impl.id}.`,
    obligation: impl.obligation ?? "must",
    compose: "all",
    triples,
  };
}

/**
 * Deterministic response classification. An explicit `payload.kind` wins (the
 * typed surface); otherwise conservative stage-local text rules apply — at
 * Stage 1 anything short of a confirmation is a correction (loopback).
 */
export function classifyUserResponse(state: DialogState, text: string, payload?: Record<string, unknown>, suffixes: string[] = [...DEFAULT_TEST_PYRAMID_SUFFIXES]): UserResponseKind {
  const explicit = payload?.kind;
  if (typeof explicit === "string") return explicit as UserResponseKind;

  const affirmative = /^\s*(yes|y\b|confirm|correct|ok\b|okay|accept|proceed|right|that('|’)s (right|correct)|looks good|lgtm)/i.test(text);
  const negative = /^\s*(no\b|reject|wrong|incorrect|skip)/i.test(text);

  switch (state.current_stage) {
    case 1:
      return affirmative ? "confirm_framing" : "reject_framing";
    case 2:
      return "resolve_tensions";
    case 3:
      if (negative) return "reject_practice_proposal";
      if (affirmative) return "accept_practice_proposal";
      return "selective_accept";
    case 4:
    case "4.5": {
      if (Array.isArray(payload?.layers)) return "pick_pyramid_layers";
      if (payload?.edited_triple !== undefined) return "revise_draft";
      if (reciprocalPending(state, suffixes)) return affirmative ? "confirm_reciprocal" : "decline_reciprocal";
      if (affirmative) return "confirm_draft";
      return "revise_draft";
    }
    case 5:
      return "noop";
  }
}
