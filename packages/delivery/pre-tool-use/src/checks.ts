import { basename } from "node:path";

import { SidecarBodySchema, type Intent } from "@dusk/core-schema";
import { parseDecorations, parseDotIntent, type DecorationRecord } from "@dusk/core-decoration";
import { findIllegalNegation } from "@dusk/core-parser";

import type { ProjectContext } from "./loadProject.js";
import type { GateWarning, Rejection } from "./rejections.js";

const IGNORE_PREDICATES = new Set([
  "is-generated-by",
  "is-replaced-by",
  "is-shimmed-for",
  "is-deprecated-in",
  "is-exempt-due-to",
  "is-governed-by-external",
]);

const EXPORTED_DECL_RE = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|enum)\s+([A-Za-z0-9_$]+)/;
const MARKER_GLOBAL_RE = /@intent(?:-support|-test-file|-test|-file|-ignore)?\b/g;
const CLOSING_ONLY_RE = /^[)\]}\s;,]*$/;

function tripleIdsOf(intent: Intent): string[] {
  if (intent.compose === "implies") return (intent.consequent ?? []).map((t) => t.id);
  return (intent.triples ?? []).map((t) => t.id);
}

function stripStringsAndComments(line: string): string {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/"(\\.|[^"\\])*"/g, '""')
    .replace(/'(\\.|[^'\\])*'/g, "''")
    .replace(/`(\\.|[^`\\])*`/g, "``");
}

function netBraces(line: string): number {
  const text = stripStringsAndComments(line);
  let n = 0;
  for (const ch of text) {
    if (ch === "{") n += 1;
    else if (ch === "}") n -= 1;
  }
  return n;
}

function netBrackets(line: string): number {
  const text = stripStringsAndComments(line);
  let n = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "{" || ch === "[") n += 1;
    else if (ch === ")" || ch === "}" || ch === "]") n -= 1;
  }
  return n;
}

const isComment = (line: string): boolean => line.trim().startsWith("//");
const isBlank = (line: string): boolean => line.trim() === "";

/** Whether the contiguous comment block immediately above `index` carries any decoration. */
function hasDecorationAbove(lines: string[], recordLines: Set<number>, index: number): boolean {
  for (let j = index - 1; j >= 0; j -= 1) {
    if (isBlank(lines[j])) continue;
    if (!isComment(lines[j])) return false;
    if (recordLines.has(j + 1)) return true;
  }
  return false;
}

function checkExportedDeclarations(lines: string[], file: string, recordLines: Set<number>): Rejection[] {
  const out: Rejection[] = [];
  lines.forEach((line, i) => {
    if (EXPORTED_DECL_RE.test(line) && !hasDecorationAbove(lines, recordLines, i)) {
      out.push({ kind: "missing_decorator", file, line: i + 1, message: `exported declaration on line ${i + 1} has no @intent decorator` });
    }
  });
  return out;
}

/** Top-level statements inside a decorated exported function body must each be decorated. */
function checkStatementDecorations(lines: string[], file: string, records: DecorationRecord[]): Rejection[] {
  const out: Rejection[] = [];
  const recordLines = new Set(records.map((r) => r.line));
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(EXPORTED_DECL_RE);
    if (!match || !/\bfunction\b/.test(lines[i]) || !hasDecorationAbove(lines, recordLines, i)) continue;

    // Locate the body: scan to the first '{', then to the matching '}'.
    let depth = 0;
    let bodyStart = -1;
    let j = i;
    for (; j < lines.length; j += 1) {
      depth += netBraces(lines[j]);
      if (bodyStart === -1 && lines[j].includes("{")) bodyStart = j + 1;
      if (bodyStart !== -1 && depth <= 0) break;
    }
    const bodyEnd = j;

    let relDepth = 0;
    let pending = false;
    for (let k = bodyStart; k < bodyEnd; k += 1) {
      const line = lines[k];
      if (recordLines.has(k + 1)) {
        pending = true;
        continue;
      }
      if (isBlank(line) || isComment(line)) continue;
      const startDepth = relDepth;
      relDepth += netBrackets(line);
      if (startDepth === 0 && !CLOSING_ONLY_RE.test(line.trim())) {
        if (!pending) out.push({ kind: "missing_statement_decorator", file, line: k + 1, message: `undecorated statement inside a decorated declaration`, details: { statement_excerpt: line.trim() } });
        pending = false;
      }
    }
  }
  return out;
}

/** Groups of decoration records on consecutive lines (one statement's decorator block). */
function recordGroups(records: DecorationRecord[]): DecorationRecord[][] {
  const sorted = [...records].sort((a, b) => a.line - b.line);
  const groups: DecorationRecord[][] = [];
  for (const record of sorted) {
    const last = groups[groups.length - 1];
    if (last && record.line === last[last.length - 1].line + 1) last.push(record);
    else groups.push([record]);
  }
  return groups;
}

export function runChecks(content: string, file: string, ctx: ProjectContext): { rejections: Rejection[]; warnings: GateWarning[] } {
  if (file.endsWith(".intent")) {
    // Dispatch by basename (design D2): exactly `.intent` → directory-scope;
    // `<stem>.intent` → per-file sidecar.
    return basename(file) === ".intent" ? runDotIntentChecks(content, file, ctx) : runFileSidecarChecks(content, file, ctx);
  }

  const lines = content.split(/\r?\n/);
  const records = parseDecorations(content, file);
  const recordLines = new Set(records.map((r) => r.line));
  const rejections: Rejection[] = [];
  const warnings: GateWarning[] = [];

  // Check 4 — one intent per line.
  lines.forEach((line, i) => {
    if (isComment(line) && (line.match(MARKER_GLOBAL_RE) ?? []).length > 1) {
      rejections.push({ kind: "multiple_intents_on_one_line", file, line: i + 1, message: "more than one intent decorator on a single line" });
    }
  });

  // Check 1 + 6 — declaration & statement decoration completeness.
  rejections.push(...checkExportedDeclarations(lines, file, recordLines));
  rejections.push(...checkStatementDecorations(lines, file, records));

  // Check 8 — same statement carrying @intent and @intent-support for the same intent.
  for (const group of recordGroups(records)) {
    const focal = new Set(group.filter((r) => r.marker === "intent").map((r) => r.intent_path));
    for (const support of group.filter((r) => r.marker === "intent-support")) {
      if (focal.has(support.intent_path)) {
        rejections.push({ kind: "focal_and_support_for_same_intent", file, line: support.line, intent_path: support.intent_path, message: `@intent and @intent-support both claim "${support.intent_path}" on the same statement` } as Rejection);
      }
    }
  }

  for (const record of records) {
    // Check 2 — resolvable intent path.
    if (!ctx.graph.has(record.intent_path)) {
      rejections.push({ kind: "unresolved_intent_path", file, line: record.line, message: `unresolved intent path "${record.intent_path}"`, details: { reference: record.intent_path } });
      continue;
    }
    const intent = ctx.graph.get(record.intent_path)!;
    const tripleIds = new Set(tripleIdsOf(intent));

    // Check 3 — resolvable aspect ids.
    for (const aspect of record.aspect_ids ?? []) {
      if (!tripleIds.has(aspect)) {
        rejections.push({ kind: "unresolved_aspect_id", file, line: record.line, message: `aspect "${aspect}" does not resolve to a triple in "${record.intent_path}"`, details: { intent_path: record.intent_path, aspect } });
      }
    }

    // Check 7 + 10 — support triple validity and predicate negation.
    if (record.marker === "intent-support") {
      if (!record.support_triple) {
        rejections.push({ kind: "missing_support_triple", file, line: record.line, message: `@intent-support for "${record.intent_path}" has no [subject, predicate, object] triple`, details: { intent_path: record.intent_path } });
      } else {
        const [subject, predicate, object] = record.support_triple;
        if (!subject || !predicate || !object) {
          rejections.push({ kind: "malformed_support_triple", file, line: record.line, message: "support triple must have non-empty subject, predicate, and object" });
        } else {
          const negation = findIllegalNegation("predicate", predicate);
          if (negation) {
            rejections.push({ kind: "malformed_support_triple", file, line: record.line, message: `matrix-predicate negation "${negation.marker}" in support-triple predicate`, hint: "use polarity: negative on the intent (see dusk/author/polarity-decision)", details: { marker: negation.marker } });
          }
        }
      }
    }

    // Check 5 — @intent-ignore because/reason/predicate vocabulary.
    if (record.marker === "intent-ignore") {
      const raw = lines[record.line - 1] ?? "";
      const because = raw.match(/because=\(([^)]*)\)/);
      const reason = /reason="([^"]*)"/.test(raw);
      if (!because) rejections.push({ kind: "missing_ignore_because", file, line: record.line, message: "@intent-ignore is missing a because=(...) clause" });
      if (!reason) rejections.push({ kind: "missing_ignore_reason", file, line: record.line, message: '@intent-ignore is missing a reason="..." clause' });
      if (because) {
        const parts = because[1].split(",").map((s) => s.trim());
        if (parts.length === 3 && !IGNORE_PREDICATES.has(parts[1])) {
          rejections.push({ kind: "invalid_ignore_predicate", file, line: record.line, message: `invalid ignore predicate "${parts[1]}"`, details: { predicate: parts[1] } });
        }
      }
    }

    // Check 9 — @intent-test path ends in a configured pyramid suffix.
    if (record.marker === "intent-test" || record.marker === "intent-test-file") {
      if (!ctx.suffixes.some((suffix) => record.intent_path.endsWith(`/${suffix}`))) {
        rejections.push({ kind: "non_test_path_on_intent_test", file, line: record.line, message: `${record.marker} path "${record.intent_path}" does not end in a configured test-pyramid suffix`, details: { intent_path: record.intent_path } });
      }
    }

    // Supersedes warning (non-blocking).
    const supersededBy = ctx.supersededBy.get(record.intent_path);
    if (supersededBy && (record.marker === "intent" || record.marker === "intent-file")) {
      warnings.push({ kind: "superseded_intent_reference", file, line: record.line, message: `intent "${record.intent_path}" is superseded by "${supersededBy}"` });
    }
  }

  return { rejections, warnings };
}

function runDotIntentChecks(content: string, file: string, ctx: ProjectContext): { rejections: Rejection[]; warnings: GateWarning[] } {
  const { records, errors } = parseDotIntent(content, file);
  const rejections: Rejection[] = [];
  const warnings: GateWarning[] = [];
  for (const error of errors) {
    if (error.message.includes("one claim per line")) rejections.push({ kind: "multiple_intents_on_one_line", file, line: error.line, message: error.message });
  }
  for (const record of records) {
    if (!ctx.graph.has(record.intent_path)) {
      rejections.push({ kind: "unresolved_intent_path", file, line: record.line, message: `unresolved intent path "${record.intent_path}"`, details: { reference: record.intent_path } });
    }
  }
  return { rejections, warnings };
}

/**
 * Per-write single-file validity for a `<stem>.intent` sidecar (design D7). This
 * is the LIVE-hook / phase-1 check: it does NOT resolve anchors against the
 * target or run cross-file coverage tiling (the target may not be co-present in a
 * two-step edit — that runs post-hoc in `gateWorktreeEdits`). It checks: the
 * sidecar parses; its declared `target` equals its stem; per-claim intent
 * paths/aspects resolve (reusing the existing checks); and ignore entries use the
 * `@intent-ignore` because predicate vocabulary.
 */
function runFileSidecarChecks(content: string, file: string, ctx: ProjectContext): { rejections: Rejection[]; warnings: GateWarning[] } {
  const rejections: Rejection[] = [];
  const warnings: GateWarning[] = [];

  let body;
  try {
    const parsed = SidecarBodySchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      rejections.push({ kind: "malformed_sidecar", file, line: 1, message: `invalid sidecar: ${parsed.error.issues[0]?.message ?? "shape mismatch"}` });
      return { rejections, warnings };
    }
    body = parsed.data;
  } catch (err) {
    rejections.push({ kind: "malformed_sidecar", file, line: 1, message: `sidecar is not valid JSON: ${(err as Error).message}` });
    return { rejections, warnings };
  }

  const stem = basename(file).slice(0, -".intent".length);
  if (body.target !== stem) {
    rejections.push({ kind: "sidecar_target_missing", file, line: 1, message: `sidecar declares target "${body.target}" but sits beside "${stem}"`, details: { declared: body.target, stem } });
  }

  for (const claim of body.claims) {
    if (!ctx.graph.has(claim.intent_path)) {
      rejections.push({ kind: "unresolved_intent_path", file, line: 1, message: `unresolved intent path "${claim.intent_path}"`, details: { reference: claim.intent_path } });
      continue;
    }
    const intent = ctx.graph.get(claim.intent_path)!;
    const tripleIds = new Set(tripleIdsOf(intent));
    for (const aspect of claim.aspect_ids ?? []) {
      if (!tripleIds.has(aspect)) {
        rejections.push({ kind: "unresolved_aspect_id", file, line: 1, message: `aspect "${aspect}" does not resolve to a triple in "${claim.intent_path}"`, details: { intent_path: claim.intent_path, aspect } });
      }
    }
  }

  for (const ig of body.ignore) {
    const predicate = ig.because[1];
    if (!IGNORE_PREDICATES.has(predicate)) {
      rejections.push({ kind: "invalid_ignore_predicate", file, line: 1, message: `invalid ignore predicate "${predicate}"`, details: { predicate } });
    }
  }

  return { rejections, warnings };
}
