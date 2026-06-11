/**
 * Transport-error classification for the real-model correctness legs
 * (arch-board 2026-06-11 S7, narrowing the D4 protocol amendment).
 *
 * A TRANSPORT error is a failure of the model-call plumbing — never content
 * evidence: the ambient `claude` CLI timing out or exiting non-zero, the
 * process failing to spawn/pipe, or the CLI's `--output-format json` envelope
 * failing to parse. These (and ONLY these) may be retried once and, on a
 * second failure, consume an N-protocol attempt as a non-success. Anything
 * else — vitest assertion failures, programming bugs (TypeError etc.) — must
 * propagate and fail the suite loudly, never be bookkept as model noise.
 *
 * The patterns mirror the actual throw sites in
 * `@dusk/runtime-verifier`'s `claudeCodeModelClient`:
 *   - `runClaude` rejects with "claude CLI timed out" / "claude CLI exited N: …"
 *   - the child `error` event surfaces Node errno errors (ENOENT, EPIPE, …)
 *   - `JSON.parse` of a malformed CLI envelope throws SyntaxError
 */

const TRANSPORT_ERRNO_CODES = new Set(["ENOENT", "EACCES", "EPIPE", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAGAIN"]);

const TRANSPORT_MESSAGE_RE = /claude CLI (timed out|exited)/;

export function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== undefined && TRANSPORT_ERRNO_CODES.has(code)) return true;
  if (error.name === "SyntaxError") return true; // malformed --output-format json envelope
  return TRANSPORT_MESSAGE_RE.test(error.message);
}
