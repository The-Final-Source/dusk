import {
  duskError,
  type AuthorGenerator,
  type ScriptedAuthorResponse,
} from "@dusk/core-schema";

/**
 * The scripted Author driver (Phase-4 design D7) — the analog of Phase 2's
 * scripted-verdict double, injected at the Author runtime's generator seam so
 * control-flow tests run with ZERO model calls. Responses are consumed in
 * order; an `expectStage` mismatch or script exhaustion returns a typed
 * `internal_error` — never a silent fallback to the real model.
 */
export function makeScriptedAuthorGenerator(script: ScriptedAuthorResponse[]): AuthorGenerator {
  let cursor = 0;
  const queue = [...script];
  return async (ctx) => {
    if (cursor >= queue.length) {
      return duskError("internal_error", `scripted author script underran (had ${queue.length} responses)`, {
        recoverable: false,
        details: { requested: cursor + 1, available: queue.length, stage: ctx.stage },
      });
    }
    const next = queue[cursor];
    if (next.expectStage !== ctx.stage) {
      return duskError("internal_error", `scripted author response ${cursor + 1} expected stage ${next.expectStage} but the runtime asked for stage ${ctx.stage}`, {
        recoverable: false,
        details: { expected: next.expectStage, actual: ctx.stage },
      });
    }
    cursor += 1;
    const { question, draftPatch, drafts, removedDraftIds, tensions, practiceProposal } = next;
    return {
      question,
      ...(draftPatch !== undefined ? { draftPatch } : {}),
      ...(drafts !== undefined ? { drafts } : {}),
      ...(removedDraftIds !== undefined ? { removedDraftIds } : {}),
      ...(tensions !== undefined ? { tensions } : {}),
      ...(practiceProposal !== undefined ? { practiceProposal } : {}),
    };
  };
}
