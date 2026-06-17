/**
 * Failure classification for the real-model call legs — the SINGLE SOURCE OF
 * TRUTH (RFC App. D.33). Lives in the `core-schema` leaf so BOTH the test/
 * benchmark layer (`@dusk/test-harness` re-exports these) AND the runtime layer
 * (the `spawnSubAgent` seam, at runtime) can classify a thrown error without a
 * package cycle. These are pure functions over an `Error`'s shape — no imports.
 *
 * A TRANSPORT error is a failure of the model-call PLUMBING — never content:
 * the ambient `claude` CLI timing out or exiting non-zero with no result
 * envelope, the process failing to spawn/pipe, or the `--output-format json`
 * envelope failing to parse. These (and ONLY these) may be retried once.
 *
 * A content/LIMIT-shaped failure is the OPPOSITE: the CLI produced a well-formed
 * result envelope carrying an error subtype (e.g. `error_max_turns`) — the
 * plumbing SUCCEEDED, the model ran, and the failure is deterministic. The
 * `runClaude` throw site tags such an error with `duskModelExit` (the subtype);
 * `isTransportError` returns FALSE for it, so it is NOT cold-retried (retrying
 * an identical deterministic call is waste and is what manufactured the fatal
 * `TransportLegFailure`).
 *
 * Programming errors — `TypeError`, assertion failures, etc. — are NEITHER, and
 * MUST propagate and fail loud; they are never bookkept as model noise.
 */

const TRANSPORT_ERRNO_CODES = new Set(["ENOENT", "EACCES", "EPIPE", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAGAIN"]);

const TRANSPORT_MESSAGE_RE = /claude CLI (timed out|exited)/;

/** True iff `error` is a content/limit-shaped model-call failure tagged at the throw site. */
function hasModelExitTag(error: Error): boolean {
  return typeof (error as { duskModelExit?: unknown }).duskModelExit === "string";
}

export function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // A content/limit-shaped failure (a well-formed CLI result envelope with an
  // error subtype, tagged `duskModelExit`) is DETERMINISTIC, not plumbing — it
  // must be surfaced by the spawn seam, never cold-retried (RFC App. D.33).
  if (hasModelExitTag(error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== undefined && TRANSPORT_ERRNO_CODES.has(code)) return true;
  if (error.name === "SyntaxError") return true; // malformed --output-format json envelope
  return TRANSPORT_MESSAGE_RE.test(error.message);
}

/**
 * A CLASSIFIED model-call/CLI failure the spawn seam SHALL surface as a returned
 * failure (rather than let crash the run): a genuine transport error, a
 * two-death `TransportLegFailure`, or a content/limit-shaped failure (tagged
 * `duskModelExit`). `TransportLegFailure` is matched by NAME — not `instanceof`
 * — because it lives in `@dusk/runtime-benchmark`, which `core-schema` must not
 * depend on. Everything else (a programming bug) returns false and MUST be
 * re-thrown by the seam (RFC App. D.33; the honesty bar — no silent
 * false-recovery). (By the time a throw reaches the seam it has already passed
 * through `withTransportRetry`, so a raw single transport error appears only as
 * a `TransportLegFailure`; the `isTransportError` arm is defensive for any
 * future caller that bypasses the retry wrapper.)
 */
export function isModelCallFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TransportLegFailure") return true;
  if (hasModelExitTag(error)) return true;
  return isTransportError(error);
}
