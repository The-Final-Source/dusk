import type { DuskError } from "./duskError.js";
import type { AuthorStage, DialogState, DraftIntent, TensionFinding } from "./dialogState.js";

/**
 * The Author-generation seam (design D7). The Author runtime's LLM half — the
 * framing/tension/practice/drafting content — is produced by an injected
 * `AuthorGenerator`. Production wires it to the ambient-model spawn path;
 * control-flow tests inject the scripted driver (the Phase-4 analog of Phase 2's
 * scripted-verdict Verifier double). The seam lives here in the leaf so
 * `@dusk/test-harness` implements the scripted side without importing
 * `@dusk/runtime-author`.
 */

export type AuthorGenerateContext = {
  stage: AuthorStage;
  state: DialogState;
  /** Mechanical context the runtime assembled for the stage (e.g. Stage-2 grep
   *  candidates, Stage-3 injected proposal content, Stage-4 revision feedback). */
  context?: Record<string, unknown>;
};

export type AuthorGeneration = {
  /** The next_question text the Author "would have generated". */
  question: string;
  /** Stage-4: a drafted (or revised) intent. Merged into `intents_drafted[]` by id. */
  draftPatch?: DraftIntent;
  /** Stage-4: additional drafts emitted in the same turn (e.g. a conditional intent). */
  drafts?: DraftIntent[];
  /**
   * Stage-4: ids to REMOVE from `intents_drafted[]` (an explicit, recorded
   * set-mutation — a revision that drops a previously drafted intent). Removing
   * an id also cascade-removes its pyramid children (`<id>/<layer>`). Without
   * this, a revision could only ADD/UPDATE, so a dropped draft survived to
   * finalize (the dogfood "removed intents still got written" friction).
   */
  removedDraftIds?: string[];
  /** Stage-2: the classified tensions surfaced by the discovery pass. */
  tensions?: TensionFinding[];
  /** Stage-3: the industry-practice proposal text. */
  practiceProposal?: string;
};

/** Returns the generation or a typed `DuskError` (e.g. script underrun / model failure). */
export type AuthorGenerator = (ctx: AuthorGenerateContext) => Promise<AuthorGeneration | DuskError>;

/**
 * One scripted Author response (design D7). `expectStage` is asserted against the
 * stage the runtime is generating for — a mismatch is a typed error, never a
 * silent re-order. On script exhaustion the driver returns `internal_error`
 * ("script underran"); there is NO silent fallback to the real model.
 */
export type ScriptedAuthorResponse = {
  expectStage: AuthorStage;
  question: string;
  draftPatch?: DraftIntent;
  drafts?: DraftIntent[];
  /** Stage-4: ids to remove from the drafted set (cascades to pyramid children). */
  removedDraftIds?: string[];
  tensions?: TensionFinding[];
  practiceProposal?: string;
};
