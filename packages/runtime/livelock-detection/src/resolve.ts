import {
  ok,
  type DialogInit,
  type LivelockResolutionVerb,
  type RuntimeResult,
  type TestVerifierLivelockReport,
} from "@dusk/core-schema";

/**
 * `dusk_resolve_livelock` dispatch (RFC §3.4.1; Phase-4 design D5 HARD CUTOVER).
 * The three verbs each map to a typed instruction the orchestrator executes:
 *   - `accept_test_as_is` → commit with a `Verifier-bypassed-test-intent` trailer,
 *     then exit to Step 5;
 *   - `modify_triple` → open a SCOPED Author dialog seeded from the report's
 *     `failing_triple` (the Phase-3 inline-`payload` form is REMOVED; callers
 *     passing it receive `config_invalid` at the MCP boundary);
 *   - `escalate` → invoke the recovery-ladder L3 freeze.
 * Keeping resolution as a typed instruction (rather than opening the dialog /
 * executing commit / freeze here) keeps this package a leaf; the MCP write
 * surface owns the Author runtime and the orchestrator owns commit + recovery.
 */

export type LivelockResolution =
  | { verb: "accept_test_as_is"; bypass: { test_intent_path: string; triple_id: string } }
  | { verb: "modify_triple"; open_dialog: { entry_mode: "scoped_triple_edit"; dialog_init: DialogInit } }
  | { verb: "escalate" };

export function resolveLivelock(report: TestVerifierLivelockReport, verb: LivelockResolutionVerb): RuntimeResult<LivelockResolution> {
  switch (verb) {
    case "accept_test_as_is":
      return ok({
        verb,
        bypass: { test_intent_path: report.test_intent_path, triple_id: report.failing_triple_id },
      });
    case "modify_triple":
      return ok({
        verb,
        open_dialog: {
          entry_mode: "scoped_triple_edit",
          dialog_init: {
            failing_triple: report.failing_triple,
            target_intent_path: report.test_intent_path,
            failing_triple_id: report.failing_triple_id,
          },
        },
      });
    case "escalate":
      return ok({ verb });
  }
}
