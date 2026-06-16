/**
 * Transport-error classification for the real-model correctness legs
 * (arch-board 2026-06-11 S7, narrowing the D4 protocol amendment).
 *
 * The implementation now lives in the `@dusk/core-schema` leaf (RFC App. D.33),
 * so BOTH this test/benchmark layer AND the runtime layer (the `spawnSubAgent`
 * seam) can classify a thrown error from one source of truth without a package
 * cycle. Re-exported here so existing `@dusk/test-harness` consumers are
 * unchanged. See `core/schema/src/modelCallError.ts` for the full contract:
 *   - `isTransportError` — plumbing failure (CLI timeout / non-zero exit with no
 *     result envelope / spawn errno / malformed JSON envelope); retryable once.
 *     Returns FALSE for a content/limit-shaped failure tagged `duskModelExit`.
 *   - `isModelCallFailure` — the seam predicate: a transport error, a two-death
 *     `TransportLegFailure`, OR a tagged content/limit failure; everything else
 *     (a programming bug) is NOT, and must propagate loud.
 */

export { isTransportError, isModelCallFailure } from "@dusk/core-schema";
