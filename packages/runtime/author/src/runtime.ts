import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { parse as parseYaml } from "yaml";
import {
  IntentProposalSchema,
  duskError,
  err,
  isDuskError,
  ok,
  type AuthorEntryMode,
  type AuthorGeneration,
  type AuthorGenerator,
  type AuthorStage,
  type DialogInit,
  type DialogState,
  type DraftIntent,
  type DuskError,
  type IntentProposal,
  type RuntimeResult,
} from "@dusk/core-schema";

import {
  newDialogId,
  readDialogState,
  withDialogLock,
  writeDialogState,
  type Clock,
} from "./dialogStore.js";
import { discoverTensionCandidates } from "./discovery.js";
import { finalizeDialog, type FinalizeFs } from "./finalize.js";
import {
  classifyUserResponse,
  transition,
  type QuestionSpec,
  type TransitionOutcome,
  type UserResponseKind,
} from "./transition.js";

/**
 * The Author runtime (RFC §5; design D1). Wraps the pure transition function
 * with the generator seam (LLM or scripted — design D7), dialog persistence
 * (every transition persists BEFORE returning — P4-T13), and the three entry
 * modes (design D5/D6). Mechanical questions (4.5 bounces, draft confirmations,
 * scoped-edit and L2 framings) render deterministically with zero model calls.
 */

export type AuthorRuntimeDeps = {
  rootDir: string;
  clock: Clock;
  generator: AuthorGenerator;
  /** Intent tree root (default `.ia/intents`). */
  intentsDir?: string;
  /** Test-pyramid suffixes (default unit/integration/e2e). */
  pyramidSuffixes?: string[];
  /** Injectable fs facade for finalize-failure tests (design D8). */
  finalizeFs?: FinalizeFs;
};

export type StartArgs = { request: string; entry_mode?: AuthorEntryMode; dialog_init?: DialogInit };
export type StartResult = { dialog_id: string; stage: AuthorStage; next_question: string };
export type ContinueArgs = { dialog_id: string; response: string; payload?: Record<string, unknown> };
export type ContinueResult = { stage: AuthorStage; next_question: string } | { finalize_ready: true };
export type FinalizeResult = { intents_created: string[] };

export type AuthorRuntime = {
  start: (args: StartArgs) => Promise<RuntimeResult<StartResult>>;
  continue: (args: ContinueArgs) => Promise<RuntimeResult<ContinueResult>>;
  finalize: (args: { dialog_id: string }) => Promise<RuntimeResult<FinalizeResult>>;
};

const iso = (clock: Clock): string => new Date(clock.now()).toISOString();

const draftIds = (state: DialogState): string => state.intents_drafted.map((d) => d.id ?? "(scaffold)").join(", ");

/** Mechanical question rendering — deterministic, zero-model. */
export function renderQuestion(spec: QuestionSpec, state: DialogState): string {
  switch (spec.type) {
    case "draft_confirmation":
      return `Confirm the drafted intent set [${draftIds(state)}]: reply "confirm" to run validation and proceed to finalize, or describe the revision you want.`;
    case "reciprocal_edge":
      return `The drafted intent "${spec.source}" declares an implies edge to "${spec.target}". Add the reciprocal edge on "${spec.target}" (kind: sibling)? Reply yes to add it, no to skip.`;
    case "stage45_bounce": {
      const hint = spec.violation.skill_hint ? ` See skill dusk/author/${spec.violation.skill_hint}.` : "";
      return `Draft validation failed [${spec.violation.code}] at ${spec.violation.draft_id} → ${spec.violation.path}: ${spec.violation.message}.${hint} Revise the draft and confirm again.`;
    }
    case "scoped_triple_edit": {
      const draft = state.intents_drafted.find((d) => d.in_place_edit);
      const t = draft?.triples?.[0];
      const target = draft?.in_place_edit?.target_intent_path ?? "(unknown)";
      return `Scoped triple edit for ${target}: the failing triple "${draft?.in_place_edit?.triple_id}" is { subject: "${t?.subject}", predicate: "${t?.predicate}", object: "${t?.object}", polarity: ${t?.polarity} }. Provide the edited triple (payload.edited_triple) or describe the revision you want.`;
    }
    default:
      return "";
  }
}

function renderL2Question(proposal: IntentProposal): string {
  const revisions = proposal.proposed_revisions.map((r) => `- ${r.intent}: ${r.suggestion}`).join("\n");
  const diagnoses = proposal.diagnoses.map((d) => `- [iter ${d.iter}] ${d.observation}`).join("\n");
  return [
    `Recovery proposal for bead ${proposal.bead_id} — the following intents could not be satisfied: ${proposal.unsatisfiable_intents.join(", ")}.`,
    "",
    "Aggregated diagnoses:",
    diagnoses.length > 0 ? diagnoses : "(none)",
    "",
    "Proposed revisions:",
    revisions.length > 0 ? revisions : "(none)",
    "",
    'Accept this proposal as the drafting scaffold ("accept"), reject it for a greenfield draft ("reject"), or describe which parts to keep (selective accept).',
  ].join("\n");
}

/** Specs whose question text comes from the generator (the LLM half of the flow). */
const GENERATED_SPECS = new Set<QuestionSpec["type"]>(["framing", "framing_regenerated", "tension_resolution", "practice_proposal", "draft_with_pyramid", "draft_revision"]);

export function createAuthorRuntime(deps: AuthorRuntimeDeps): AuthorRuntime {
  const intentsDir = deps.intentsDir ?? ".ia/intents";

  const appendAuthorTurn = (state: DialogState, content: string, stage: AuthorStage): DialogState => ({
    ...state,
    transcript: [...state.transcript, { role: "author", content, stage, at: iso(deps.clock) }],
  });

  const persist = (state: DialogState): DialogState => {
    const touched = { ...state, last_touched_at: iso(deps.clock) };
    writeDialogState(deps.rootDir, touched);
    return touched;
  };

  /** Merge a generated draft into the drafted set (by id; the scaffold absorbs the first draft). */
  const mergeDraft = (state: DialogState, patch: DraftIntent): DialogState => {
    const drafts = [...state.intents_drafted];
    const byId = patch.id !== undefined ? drafts.findIndex((d) => d.id === patch.id) : -1;
    if (byId !== -1) {
      drafts[byId] = { ...drafts[byId], ...patch };
    } else {
      const scaffoldIdx = drafts.findIndex((d) => d.id === undefined && d.triples === undefined && d.in_place_edit === undefined);
      if (scaffoldIdx !== -1) drafts[scaffoldIdx] = { ...drafts[scaffoldIdx], ...patch };
      else drafts.push(patch);
    }
    return { ...state, intents_drafted: drafts };
  };

  const applyGeneration = (state: DialogState, gen: AuthorGeneration): DialogState => {
    let next = state;
    if (gen.tensions !== undefined) {
      const drafts = [...next.intents_drafted];
      if (drafts.length === 0) drafts.push({});
      drafts[0] = { ...drafts[0], tensions_surfaced: gen.tensions };
      next = { ...next, intents_drafted: drafts };
    }
    if (gen.draftPatch) next = mergeDraft(next, gen.draftPatch);
    for (const draft of gen.drafts ?? []) next = mergeDraft(next, draft);
    return next;
  };

  const generate = async (stage: AuthorStage, state: DialogState, context?: Record<string, unknown>): Promise<RuntimeResult<AuthorGeneration>> => {
    const gen = await deps.generator({ stage, state, ...(context ? { context } : {}) });
    if (isDuskError(gen)) return err(gen);
    return ok(gen);
  };

  /**
   * Run the generator for an `ask` outcome that needs generated content, apply
   * its drafts/tensions, append the author turn, persist, and shape the reply.
   * Mechanical questions skip the generator entirely.
   */
  const completeAsk = async (
    state: DialogState,
    outcome: Extract<TransitionOutcome, { kind: "ask" }>,
    context?: Record<string, unknown>,
  ): Promise<RuntimeResult<{ state: DialogState; stage: AuthorStage; next_question: string }>> => {
    let next = state;
    let question: string;

    if (GENERATED_SPECS.has(outcome.question.type)) {
      // ---- Stage 2: agent-driven grep over .ia/intents precedes classification (RFC §8.10). ----
      let genContext = context;
      if (outcome.question.type === "tension_resolution") {
        const candidates = discoverTensionCandidates(deps.rootDir, intentsDir, next.request);
        genContext = { ...genContext, candidates };
      }
      if (outcome.question.type === "practice_proposal") {
        const scaffold = next.intents_drafted[0];
        genContext = { ...genContext, tension_resolutions: scaffold?.tension_resolutions ?? [] };
      }
      if (outcome.question.type === "draft_with_pyramid") {
        genContext = { ...genContext, greenfield: outcome.question.greenfield, practice_scaffold: next.intents_drafted[0]?.practice_scaffold ?? null };
      }
      const gen = await generate(outcome.stage, next, genContext);
      if (!gen.success) return gen;
      next = applyGeneration(next, gen.value);

      // Stage-2 with zero surfaced tensions: advance straight to Stage 3 (RFC §5 — zero-to-N tensions).
      if (outcome.question.type === "tension_resolution" && (gen.value.tensions ?? []).length === 0) {
        next = { ...next, current_stage: 3 };
        const practice = await generate(3, next, { tension_resolutions: [] });
        if (!practice.success) return practice;
        next = applyGeneration(next, practice.value);
        const content = practice.value.practiceProposal ? `${practice.value.practiceProposal}\n\n${practice.value.question}` : practice.value.question;
        next = appendAuthorTurn(next, content, 3);
        return ok({ state: next, stage: 3, next_question: practice.value.question });
      }

      const content =
        outcome.stage === 3 && gen.value.practiceProposal ? `${gen.value.practiceProposal}\n\n${gen.value.question}` : gen.value.question;
      next = appendAuthorTurn(next, content, outcome.stage);
      question = gen.value.question;
    } else {
      question = renderQuestion(outcome.question, next);
      next = appendAuthorTurn(next, question, outcome.stage);
    }

    return ok({ state: next, stage: outcome.stage, next_question: question });
  };

  const start: AuthorRuntime["start"] = async (args) => {
    const mode: AuthorEntryMode = args.entry_mode ?? "full";
    const now = iso(deps.clock);
    const baseState = (dialogId: string, stage: AuthorStage, drafts: DraftIntent[]): DialogState => ({
      schema_version: 1,
      dialog_id: dialogId,
      request: args.request,
      current_stage: stage,
      transcript: [],
      intents_drafted: drafts,
      created_at: now,
      last_touched_at: now,
    });

    if (mode === "scoped_triple_edit") {
      const init = args.dialog_init;
      if (!init?.failing_triple || !init.target_intent_path || !init.failing_triple_id) {
        return err(
          duskError("config_invalid", "scoped_triple_edit requires dialog_init { failing_triple, target_intent_path, failing_triple_id }", {
            recoverable: true,
            recovery_hint: "seed dialog_init from TestVerifierLivelockReport (failing_triple, test_intent_path, failing_triple_id)",
          }),
        );
      }
      const dialogId = newDialogId(deps.rootDir, deps.clock);
      const draft: DraftIntent = {
        id: init.target_intent_path,
        in_place_edit: { target_intent_path: init.target_intent_path, triple_id: init.failing_triple_id },
        triples: [{ ...init.failing_triple, id: init.failing_triple_id }],
      };
      let state = baseState(dialogId, 4, [draft]);
      const question = renderQuestion({ type: "scoped_triple_edit" }, state);
      state = appendAuthorTurn(state, question, 4);
      persist(state);
      return ok({ dialog_id: dialogId, stage: 4 as AuthorStage, next_question: question });
    }

    if (mode === "l2_recovery") {
      const proposalPath = args.dialog_init?.proposal_path;
      const unreadable = (reason: string): DuskError =>
        duskError("author_l2_proposal_unreadable", `L2 recovery proposal unreadable: ${reason}`, {
          recoverable: true,
          details: { proposal_path: proposalPath ?? null },
          recovery_hint: "verify the bead's intent-proposal.yaml exists and parses, then retry dusk_author_start({entry_mode: \"l2_recovery\"})",
        });
      if (!proposalPath) return err(unreadable("dialog_init.proposal_path is required"));
      const absolute = isAbsolute(proposalPath) ? proposalPath : join(deps.rootDir, proposalPath);
      if (!existsSync(absolute)) return err(unreadable(`no file at ${proposalPath}`));
      let proposal: IntentProposal;
      try {
        proposal = IntentProposalSchema.parse(parseYaml(readFileSync(absolute, "utf8")));
      } catch (error) {
        return err(unreadable(`failed to parse ${proposalPath}: ${(error as Error).message}`));
      }
      const dialogId = newDialogId(deps.rootDir, deps.clock);
      let state = baseState(dialogId, 3, []);
      const question = renderL2Question(proposal);
      state = appendAuthorTurn(state, question, 3);
      persist(state);
      return ok({ dialog_id: dialogId, stage: 3 as AuthorStage, next_question: question });
    }

    // ---- full: Stage 1 Intake & Framing. ----
    const dialogId = newDialogId(deps.rootDir, deps.clock);
    let state = baseState(dialogId, 1, []);
    const gen = await generate(1, state);
    if (!gen.success) return gen;
    state = applyGeneration(state, gen.value);
    state = appendAuthorTurn(state, gen.value.question, 1);
    persist(state);
    return ok({ dialog_id: dialogId, stage: 1 as AuthorStage, next_question: gen.value.question });
  };

  /** Typed payload validation: a malformed structured response is `author_stage_invalid_response`
   *  and the dialog is preserved at its current stage (the user retries). */
  const validatePayload = (state: DialogState, payload?: Record<string, unknown>): DuskError | null => {
    if (!payload) return null;
    const invalid = (reason: string): DuskError =>
      duskError("author_stage_invalid_response", `response payload does not match stage ${state.current_stage}'s expectations: ${reason}`, {
        recoverable: true,
        details: { current_stage: state.current_stage },
        recovery_hint: "the dialog is preserved at the same stage — retry with a well-formed payload",
      });
    const KINDS = [
      "confirm_framing", "reject_framing", "resolve_tensions", "accept_practice_proposal", "selective_accept",
      "reject_practice_proposal", "pick_pyramid_layers", "confirm_reciprocal", "decline_reciprocal", "revise_draft", "confirm_draft", "noop",
    ];
    if (payload.kind !== undefined && (typeof payload.kind !== "string" || !KINDS.includes(payload.kind))) {
      return invalid(`unknown response kind "${String(payload.kind)}"`);
    }
    if (payload.layers !== undefined && !(Array.isArray(payload.layers) && payload.layers.every((l) => typeof l === "string"))) {
      return invalid("payload.layers must be an array of pyramid-layer names");
    }
    if (payload.resolutions !== undefined && !(Array.isArray(payload.resolutions) && payload.resolutions.every((r) => typeof r === "object" && r !== null))) {
      return invalid("payload.resolutions must be an array of { target, resolution } objects");
    }
    if (payload.edited_triple !== undefined) {
      const t = payload.edited_triple as Record<string, unknown>;
      const slotsOk = t !== null && typeof t === "object" && ["subject", "predicate", "object"].every((slot) => typeof t[slot] === "string" && (t[slot] as string).length > 0);
      if (!slotsOk) return invalid("payload.edited_triple must carry non-empty subject/predicate/object slots");
    }
    return null;
  };

  const continueDialog: AuthorRuntime["continue"] = (args) =>
    withDialogLock(deps.rootDir, args.dialog_id, async (): Promise<RuntimeResult<ContinueResult>> => {
      const read = readDialogState(deps.rootDir, args.dialog_id);
      if (!read.success) return read;
      const state = read.value;

      const payloadError = validatePayload(state, args.payload);
      if (payloadError) return err(payloadError);

      const kind: UserResponseKind = classifyUserResponse(state, args.response, args.payload, deps.pyramidSuffixes);
      const { nextState, outcome } = transition(
        state,
        { kind, text: args.response, ...(args.payload ? { payload: args.payload } : {}), at: iso(deps.clock) },
        { pyramidSuffixes: deps.pyramidSuffixes },
      );

      if (outcome.kind === "finalize_ready") {
        persist(nextState);
        return ok({ finalize_ready: true });
      }

      // Reciprocal confirmation materializes the reciprocal draft via the generator.
      const context = kind === "confirm_reciprocal" && outcome.question.type === "draft_confirmation" ? { reciprocal_confirmed: true } : kind === "revise_draft" ? { revision: args.response } : undefined;
      const completed = await completeAsk(nextState, outcome, context);
      if (!completed.success) return completed;
      persist(completed.value.state);
      return ok({ stage: completed.value.stage, next_question: completed.value.next_question });
    });

  const finalize: AuthorRuntime["finalize"] = (args) =>
    withDialogLock(deps.rootDir, args.dialog_id, async (): Promise<RuntimeResult<FinalizeResult>> => {
      const read = readDialogState(deps.rootDir, args.dialog_id);
      if (!read.success) return read;
      const state = read.value;
      if (state.current_stage !== 5) {
        return err(
          duskError("author_stage_invalid_response", `dialog ${args.dialog_id} is at stage ${state.current_stage}, not finalize-ready`, {
            recoverable: true,
            details: { current_stage: state.current_stage },
            recovery_hint: "drive the dialog to Stage 5 via dusk_author_continue (confirm the draft so Stage 4.5 validates) before finalizing",
          }),
        );
      }
      return finalizeDialog({
        rootDir: deps.rootDir,
        intentsDir,
        state,
        ...(deps.finalizeFs ? { fs: deps.finalizeFs } : {}),
      });
    });

  return { start, continue: continueDialog, finalize };
}
