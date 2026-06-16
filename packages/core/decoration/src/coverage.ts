import { createScanner } from "jsonc-parser";

import type { SidecarSpan } from "./parseFileIntentSidecar.js";

// jsonc-parser's `SyntaxKind` is an ambient `const enum`, which `tsc` cannot
// inline under `isolatedModules`. We reference the (stable) numeric values
// directly — see `node_modules/jsonc-parser/lib/umd/main.d.ts`.
const SYNTAX_KIND = {
  NullKeyword: 7,
  TrueKeyword: 8,
  FalseKeyword: 9,
  StringLiteral: 10,
  NumericLiteral: 11,
  Unknown: 16,
  EOF: 17,
} as const;

/**
 * Universal full-coverage computation for comment-less targets (design D4). The
 * "non-trivial" predicate is defined explicitly for JSON/JSONC — NOT by reusing
 * the TypeScript `CLOSING_ONLY_RE` (which mis-handles `"build": "tsc",`). It is
 * evaluated against the location-aware tokenizer (comment vs string vs
 * structural), never a raw regex over physical lines, so a value sharing a line
 * with a block-comment open or a multi-line string is attributed by token.
 *
 * A line is **trivial** iff, after trimming, it is (a) empty, (b) solely
 * structural tokens (`{ } [ ] , :`) + whitespace, OR (c) a JSONC comment line.
 * A line bearing a key or scalar value is **non-trivial** and must be covered.
 */

/** Tokens that carry an authored key or scalar value (and so make a line non-trivial). */
const CONTENT_KINDS = new Set<number>([
  SYNTAX_KIND.StringLiteral,
  SYNTAX_KIND.NumericLiteral,
  SYNTAX_KIND.TrueKeyword,
  SYNTAX_KIND.FalseKeyword,
  SYNTAX_KIND.NullKeyword,
  SYNTAX_KIND.Unknown,
]);

/** Offsets at which each line begins (line 1 → index 0). */
function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

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

/** The set of 1-based non-trivial lines of a JSON/JSONC target (the lines that must be covered). */
export function nonTrivialLines(targetSource: string): Set<number> {
  const lineStarts = buildLineStarts(targetSource);
  const lines = new Set<number>();
  const scanner = createScanner(targetSource, false);
  let kind = scanner.scan();
  while (kind !== SYNTAX_KIND.EOF) {
    if (CONTENT_KINDS.has(kind)) {
      const start = scanner.getTokenOffset();
      const end = start + Math.max(0, scanner.getTokenLength() - 1);
      for (let line = lineOf(lineStarts, start); line <= lineOf(lineStarts, end); line += 1) lines.add(line);
    }
    kind = scanner.scan();
  }
  return lines;
}

const linesOfSpan = (span: SidecarSpan): number[] => {
  const out: number[] = [];
  for (let l = span.startLine; l <= span.endLine; l += 1) out.push(l);
  return out;
};

export type SpanOverlap = { a: string; b: string };

export type SidecarCoverage = {
  /** Non-trivial target lines owned by no claim and no ignore span (a gate hard-block). */
  uncoveredLines: number[];
  /** Pairs of region claims whose spans overlap (`overlapping_anchors`). */
  overlaps: SpanOverlap[];
};

/**
 * Compute coverage for one target: `uncovered = non-trivial − covered − ignored`.
 * Region claims that overlap each other are reported (the whole-file root `""`
 * claim is the maximal tile and is exempt — it intentionally contains everything).
 */
export function computeSidecarCoverage(
  targetSource: string,
  claimSpans: SidecarSpan[],
  ignoreSpans: SidecarSpan[],
): SidecarCoverage {
  const required = nonTrivialLines(targetSource);
  const covered = new Set<number>();
  for (const span of claimSpans) for (const l of linesOfSpan(span)) covered.add(l);
  const ignored = new Set<number>();
  for (const span of ignoreSpans) for (const l of linesOfSpan(span)) ignored.add(l);

  const uncoveredLines = [...required].filter((l) => !covered.has(l) && !ignored.has(l)).sort((a, b) => a - b);

  const overlaps: SpanOverlap[] = [];
  const regions = claimSpans.filter((s) => s.anchor !== "");
  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) {
      const a = regions[i];
      const b = regions[j];
      if (a.startLine <= b.endLine && b.startLine <= a.endLine) overlaps.push({ a: a.anchor, b: b.anchor });
    }
  }
  return { uncoveredLines, overlaps };
}
