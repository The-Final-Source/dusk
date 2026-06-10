import {
  duskError,
  type VerifierFactory,
  type VerifierFixtureScript,
  type VerifierResult,
  type VerifierSpawnContext,
} from "@dusk/core-schema";

import { incrementSpawnCount } from "./spawnCount.js";

/**
 * The scripted-verdict Verifier double (design D5; deferred from Phase-1 D7).
 * Implements `VerifierFactory` so it plugs into `spawnSubAgent` via the
 * `verifierFactory?` seam. Returns the fixture's verdicts in order (array) or by
 * selector, performs ZERO model calls, and increments the process-local
 * `spawnCount` on every invocation. It leaves `reportUsage` UNCALLED — so the
 * emitted trace carries `prompt_tokens: 0`, `completion_tokens: 0`,
 * `cost_usd: 0`, the only fields that differ from a real Verifier trace.
 *
 * On exhaustion it returns a typed `internal_error` (recoverable: false) — never
 * a fabricated verdict ("no silent behavior").
 */
export function scriptedVerdictFactory(script: VerifierFixtureScript): VerifierFactory {
  if (typeof script === "function") {
    return async (ctx: VerifierSpawnContext): Promise<VerifierResult> => {
      incrementSpawnCount();
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
    incrementSpawnCount();
    if (cursor >= queue.length) {
      return duskError("internal_error", `scripted verifier script underran (had ${queue.length} verdicts)`, {
        recoverable: false,
        details: { requested: cursor + 1, available: queue.length },
      });
    }
    return queue[cursor++];
  };
}
