import { isTransportError } from "@dusk/test-harness";

/**
 * The pre-registered transport-failure amendment (Phase-4 board S7) — applied
 * to EVERY Phase-5 real-model leg:
 *  - a transport-classified error (CLI timeout/exit, spawn errno, malformed
 *    envelope) is a NULL observation that consumes the single retry — never a
 *    silent pass;
 *  - two transport deaths on the same observation fail the leg outright;
 *  - assertion failures and programming errors are NEVER classified as
 *    transport noise — they propagate immediately without consuming the retry.
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
