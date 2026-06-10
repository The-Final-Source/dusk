import {
  duskError,
  type VerifierFactory,
  type VerifierFixtureScript,
  type VerifierResult,
  type VerifierSpawnContext,
} from "@dusk/core-schema";

export type { VerifierFixtureScript, VerifierFactory, VerifierSpawnContext, ScriptedVerdictFactory } from "@dusk/core-schema";

/**
 * The pure scripted-verdict seam (task 1.3c). Returns a `VerifierFactory` that
 * yields the fixture's verdicts in order (array) or by selector, performing zero
 * model calls. On exhaustion it returns a typed `internal_error` — never a
 * fabricated verdict ("no silent behavior"). The `verifier-test-double` package
 * (task 4.x) wraps this with process-local `spawnCount` telemetry.
 */
export function makeScriptedVerdictFactory(script: VerifierFixtureScript): VerifierFactory {
  if (typeof script === "function") {
    return async (ctx: VerifierSpawnContext): Promise<VerifierResult> => {
      const verdict = script(ctx);
      if (verdict === undefined) {
        return duskError("internal_error", "scripted verifier selector returned no verdict for the spawn context", {
          recoverable: false,
          details: { intentPath: ctx.intentPath, aspectId: ctx.aspectId },
        });
      }
      return verdict;
    };
  }

  let cursor = 0;
  const queue = [...script];
  return async (): Promise<VerifierResult> => {
    if (cursor >= queue.length) {
      return duskError("internal_error", `scripted verifier script underran (had ${queue.length} verdicts)`, {
        recoverable: false,
        details: { requested: cursor + 1, available: queue.length },
      });
    }
    return queue[cursor++];
  };
}
