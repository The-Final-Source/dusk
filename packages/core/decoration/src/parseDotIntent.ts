import type { DecorationRecord } from "./types.js";

export type DotIntentError = { line: number; message: string };

export type DotIntentParse = { records: DecorationRecord[]; errors: DotIntentError[] };

/**
 * Parse a directory-scope `.intent` file (RFC §2.7, App. A.3): `@intent <path> [aspects]`,
 * one claim per line, `#` comments. Directory-level invariants only.
 */
export function parseDotIntent(source: string, file: string): DotIntentParse {
  const lines = source.split(/\r?\n/);
  const records: DecorationRecord[] = [];
  const errors: DotIntentError[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/#.*$/, "").trim();
    if (line === "") continue;
    if ((line.match(/@intent\b/g) ?? []).length > 1) {
      errors.push({ line: i + 1, message: "more than one claim on a single line (one claim per line)" });
      continue;
    }
    const matched = line.match(/^@intent\s+([^\s[]+)\s*(?:\[([^\]]*)\])?\s*$/);
    if (!matched) {
      errors.push({ line: i + 1, message: `invalid .intent line: ${lines[i].trim()}` });
      continue;
    }
    const aspectIds = matched[2] ? matched[2].split(",").map((s) => s.trim()).filter(Boolean) : null;
    records.push({
      file,
      line: i + 1,
      scope: "directory",
      declaration_name: null,
      marker: "intent",
      intent_path: matched[1],
      aspect_ids: aspectIds,
      support_triple: null,
      ignore_clause: null,
    });
  }
  return { records, errors };
}
