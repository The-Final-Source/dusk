import { isTransportError } from "./modelCallError.js";

/**
 * The transport-failure retry primitive — lifted into the `core-schema` leaf (RFC
 * App. D.34, design D1) so it is reachable on the runtime verifier path WITHOUT a
 * `@dusk/runtime-benchmark` / `@dusk/test-harness` edge (the handoff's
 * "transport-retry lives only in benchmark" hole, closed at the root). It depends
 * only on `isTransportError`, which already lives here. `@dusk/runtime-benchmark`
 * re-exports both symbols for back-compat.
 *
 *  - a transport-classified error (CLI timeout/exit, spawn errno, malformed
 *    envelope) is a NULL observation that consumes the single retry — never a
 *    silent pass;
 *  - two transport deaths on the same observation fail the leg outright (a
 *    `TransportLegFailure` the spawn seam then classifies `no_verdict`);
 *  - a deterministic limit (`duskModelExit`-tagged) and programming errors are
 *    NEVER classified transport — they propagate immediately without retry.
 */

export class TransportLegFailure extends Error {
  readonly attempts: [unknown, unknown];

  constructor(first: unknown, second: unknown) {
    super(`transport leg failure: two transport-classified deaths on the same observation (${String(first)}; ${String(second)})`);
    this.name = "TransportLegFailure";
    this.attempts = [first, second];
  }
}

export async function withTransportRetry<T>(observe: () => Promise<T>): Promise<T> {
  try {
    return await observe();
  } catch (first) {
    if (!isTransportError(first)) throw first;
    try {
      return await observe();
    } catch (second) {
      if (!isTransportError(second)) throw second;
      throw new TransportLegFailure(first, second);
    }
  }
}
