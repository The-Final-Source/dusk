/**
 * Allowlist-driven redaction (design D2). Applied to EVERY outgoing trace
 * string field before serialization — defense in depth — so a test/benchmark
 * `raw_prompt` never persists a secret. Two known shapes are scrubbed:
 *   - Anthropic API keys  → <redacted:anthropic_api_key>
 *   - absolute fs paths   → <redacted:abs_path>
 * Plus an injectable `repoRoot` substring (the project's own absolute path).
 *
 * The matcher is intentionally conservative: it targets secret-shaped tokens,
 * not relative intent paths (`notifications/send` has no leading slash and is
 * never matched).
 */

const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_-]{8,}/g;
// Absolute POSIX paths rooted at a real filesystem prefix.
const ABS_PATH = /\/(?:Users|home|root|var|private|tmp|opt|etc|mnt|srv)\/[^\s'"`)\]]+/g;

export const REDACTED_ANTHROPIC = "<redacted:anthropic_api_key>";
export const REDACTED_ABS_PATH = "<redacted:abs_path>";

export type RedactionOptions = { repoRoot?: string };

/** Redact a single string. Order: key shape → injected repoRoot → generic abs paths. */
export function redact(text: string, opts: RedactionOptions = {}): string {
  let out = text.replace(ANTHROPIC_KEY, REDACTED_ANTHROPIC);
  if (opts.repoRoot && opts.repoRoot.length > 0) {
    out = out.split(opts.repoRoot).join(REDACTED_ABS_PATH);
  }
  out = out.replace(ABS_PATH, REDACTED_ABS_PATH);
  return out;
}

/** Recursively redact every string in an object/array; non-strings pass through. */
export function redactDeep<T>(value: T, opts: RedactionOptions = {}): T {
  if (typeof value === "string") return redact(value, opts) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, opts)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = redactDeep(val, opts);
    return out as T;
  }
  return value;
}
