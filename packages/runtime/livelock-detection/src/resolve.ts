import {
  duskError,
  err,
  ok,
  type LivelockResolutionVerb,
  type RuntimeResult,
  type TestVerifierLivelockReport,
  type Triple,
} from "@dusk/core-schema";

/**
 * `dusk_resolve_livelock` dispatch (RFC §3.4.1; design Q4; 10.2). The three verbs
 * each map to a typed instruction the orchestrator executes:
 *   - `accept_test_as_is` → commit with a `Verifier-bypassed-test-intent` trailer,
 *     then exit to Step 5;
 *   - `modify_triple` → refresh the failing triple in-memory (Phase-3 inline
 *     payload form; Phase 4 rewires to `dusk_author_continue`) and re-enter Step 4;
 *   - `escalate` → invoke the recovery-ladder L3 freeze.
 * Keeping resolution as a typed instruction (rather than executing commit/freeze
 * here) keeps this package a leaf; the orchestrator owns the worktree + commit +
 * recovery-ladder.
 */

export type LivelockResolution =
  | { verb: "accept_test_as_is"; bypass: { test_intent_path: string; triple_id: string } }
  | { verb: "modify_triple"; edited_triple: Triple }
  | { verb: "escalate" };

export type ResolveLivelockPayload = { edited_triple?: Triple };

export function resolveLivelock(
  report: TestVerifierLivelockReport,
  verb: LivelockResolutionVerb,
  payload?: ResolveLivelockPayload,
): RuntimeResult<LivelockResolution> {
  switch (verb) {
    case "accept_test_as_is":
      return ok({
        verb,
        bypass: { test_intent_path: report.test_intent_path, triple_id: report.failing_triple_id },
      });
    case "modify_triple":
      if (!payload?.edited_triple) {
        return err(
          duskError("config_invalid", "modify_triple requires payload.edited_triple (Phase-3 inline form)", {
            recoverable: true,
            bead_id: report.bead_id,
            recovery_hint: "pass { edited_triple } in the dusk_resolve_livelock payload",
          }),
        );
      }
      return ok({ verb, edited_triple: payload.edited_triple });
    case "escalate":
      return ok({ verb });
  }
}
