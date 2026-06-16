import { parseTree, type Node, type ParseError } from "jsonc-parser";
import { SidecarBodySchema, type SidecarBody } from "@dusk/core-schema";

import type { DecorationRecord } from "./types.js";

/**
 * The per-file sidecar parser (D.28; design D3, board R1). The sidecar stores a
 * JSON Pointer (RFC 6901) per claim — the source of truth — and line spans are
 * DERIVED every run by parsing the target with `jsonc-parser` (`parseTree` +
 * manual RFC-6901 navigation; native JSONC; zero runtime deps). Line numbers are
 * never stored. A pointer that no longer resolves is a hard `unresolved_anchor`
 * finding (never a silent skip) — the anti-drift property that makes a sidecar
 * acceptable here though D.11 rejects it for comment-bearing code.
 */

export type SidecarFindingKind = "malformed_sidecar" | "unresolved_anchor";

export type SidecarFinding = {
  kind: SidecarFindingKind;
  /** The sidecar file (`<stem>.intent`). */
  sidecar: string;
  /** The target file (the stem). */
  target: string;
  /** The JSON Pointer that failed (for `unresolved_anchor`). */
  anchor?: string;
  message: string;
};

/** A resolved `[startLine, endLine]` span (1-based, inclusive) for an anchor. */
export type SidecarSpan = { anchor: string; startLine: number; endLine: number };

export type SidecarParse = {
  /** The declared `target` field, or `null` when the body is malformed. */
  declaredTarget: string | null;
  /** Claim records for the derived index (always `verify: "structural"`). */
  records: DecorationRecord[];
  /** Resolved spans of `claims` (the covered set for coverage tiling). */
  claimSpans: SidecarSpan[];
  /** Resolved spans of `ignore` entries (the ignored set for coverage tiling). */
  ignoreSpans: SidecarSpan[];
  findings: SidecarFinding[];
};

/** Offsets at which each line begins (line 1 → index 0). */
function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

/** 1-based line containing a char offset (binary search over `lineStarts`). */
function lineOf(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Navigate a JSON Pointer (RFC 6901) over the AST. `""` → the whole document. */
function resolvePointer(root: Node, pointer: string): Node | undefined {
  if (pointer === "") return root;
  let node: Node | undefined = root;
  for (const rawSeg of pointer.split("/").slice(1)) {
    if (!node) return undefined;
    const seg = rawSeg.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node.type === "object") {
      const prop: Node | undefined = (node.children ?? []).find(
        (c: Node) => c.type === "property" && c.children?.[0]?.value === seg,
      );
      node = prop?.children?.[1]; // the value node (the region span)
    } else if (node.type === "array") {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0) return undefined;
      node = (node.children ?? [])[idx];
    } else {
      return undefined;
    }
  }
  return node;
}

function spanOf(node: Node, lineStarts: number[]): { startLine: number; endLine: number } {
  return {
    startLine: lineOf(lineStarts, node.offset),
    endLine: lineOf(lineStarts, node.offset + Math.max(0, node.length - 1)),
  };
}

/**
 * Parse a `<stem>.intent` sidecar against its target. `sidecarFile`/`targetFile`
 * are the relative paths used in records (records' `file` is the TARGET, so
 * `reverse(target)` links it to its intents) and findings.
 */
export function parseFileIntentSidecar(
  sidecarSource: string,
  targetSource: string,
  sidecarFile: string,
  targetFile: string,
): SidecarParse {
  const empty: SidecarParse = { declaredTarget: null, records: [], claimSpans: [], ignoreSpans: [], findings: [] };

  let body: SidecarBody;
  try {
    const parsed = SidecarBodySchema.safeParse(JSON.parse(sidecarSource));
    if (!parsed.success) {
      return { ...empty, findings: [{ kind: "malformed_sidecar", sidecar: sidecarFile, target: targetFile, message: parsed.error.issues[0]?.message ?? "invalid sidecar shape" }] };
    }
    body = parsed.data;
  } catch (err) {
    return { ...empty, findings: [{ kind: "malformed_sidecar", sidecar: sidecarFile, target: targetFile, message: `sidecar is not valid JSON: ${(err as Error).message}` }] };
  }

  const parseErrors: ParseError[] = [];
  const root = parseTree(targetSource, parseErrors, { allowTrailingComma: true });
  if (!root || parseErrors.length > 0) {
    return { ...empty, declaredTarget: body.target, findings: [{ kind: "malformed_sidecar", sidecar: sidecarFile, target: targetFile, message: "target is not parseable as JSON/JSONC" }] };
  }

  const lineStarts = buildLineStarts(targetSource);
  const records: DecorationRecord[] = [];
  const claimSpans: SidecarSpan[] = [];
  const ignoreSpans: SidecarSpan[] = [];
  const findings: SidecarFinding[] = [];

  for (const claim of body.claims) {
    const node = resolvePointer(root, claim.anchor);
    if (!node) {
      findings.push({ kind: "unresolved_anchor", sidecar: sidecarFile, target: targetFile, anchor: claim.anchor, message: `JSON Pointer "${claim.anchor}" does not resolve against ${targetFile}` });
      continue;
    }
    const { startLine, endLine } = spanOf(node, lineStarts);
    claimSpans.push({ anchor: claim.anchor, startLine, endLine });
    records.push({
      file: targetFile,
      line: startLine,
      scope: claim.anchor === "" ? "file" : "region",
      declaration_name: null,
      marker: claim.marker,
      intent_path: claim.intent_path,
      aspect_ids: claim.aspect_ids ?? null,
      support_triple: null,
      ignore_clause: null,
      anchor: claim.anchor,
      verify: "structural",
    });
  }

  for (const ig of body.ignore) {
    const node = resolvePointer(root, ig.anchor);
    if (!node) {
      findings.push({ kind: "unresolved_anchor", sidecar: sidecarFile, target: targetFile, anchor: ig.anchor, message: `ignore JSON Pointer "${ig.anchor}" does not resolve against ${targetFile}` });
      continue;
    }
    ignoreSpans.push({ anchor: ig.anchor, ...spanOf(node, lineStarts) });
  }

  return { declaredTarget: body.target, records, claimSpans, ignoreSpans, findings };
}
