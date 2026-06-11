import type { ImportGraph } from "@dusk/runtime-long-cycle";
import type { CitationTier } from "@dusk/core-schema";

/**
 * Citation-precision scorer — Phase 5 design D2 (P5-T2; RFC §7.5.1). A PURE
 * structural transform with ZERO model calls: an LLM-judge here would
 * re-introduce the very correlation the audit measures. Deliberately a leaf
 * function so the audit, the benchmark, and any v1.x dashboard call the
 * identical implementation.
 *
 * Tiers:
 *  - `aligned`   — any citation within ±2 lines of the seeded defect, correct file.
 *  - `adjacent`  — same file beyond ±2, OR a file in the 1-hop import set of the
 *                  defect file (the SAME adjacency machinery the Phase-3 long
 *                  cycle uses — one source of truth for "1-hop").
 *  - `unaligned` — everything else, INCLUDING the no-citation case, which is
 *                  additionally flagged as its own actionable condition.
 */

export type CitationEvidence = {
  /** The verdict's structured `evidence.focal_claim` references. */
  focal_claims: Array<{ file: string; lines: [number, number] }>;
};

export type GroundTruthDefectLoc = { file: string; line: number };

export type CitationScore = {
  tier: CitationTier;
  /** True when neither the structured evidence nor the rationale carried any file:line citation. */
  no_citation: boolean;
};

type Candidate = { file: string; from: number; to: number };

const FILE_LINE_RE = /(\S+?\.(?:ts|tsx|js|jsx|mts|cts)):(\d+)(?:-(\d+))?/g;
const FILE_MENTION_RE = /(\S+?\.(?:ts|tsx|js|jsx|mts|cts))\b/g;
const BARE_LINES_RE = /\blines?\s+(\d+)(?:\s*[-–]\s*(\d+))?/g;

/** Extract `file:line` citations from rationale text, plus bare `line N` forms anchored to the nearest preceding file mention. */
export function extractCitations(rationale: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const m of rationale.matchAll(FILE_LINE_RE)) {
    const from = Number(m[2]);
    candidates.push({ file: m[1], from, to: m[3] ? Number(m[3]) : from });
  }
  // Bare "line 12" / "lines 12-14" anchored to the most recent file mention before them.
  const mentions = [...rationale.matchAll(FILE_MENTION_RE)].map((m) => ({ file: m[1], at: m.index ?? 0 }));
  for (const m of rationale.matchAll(BARE_LINES_RE)) {
    const at = m.index ?? 0;
    const anchor = [...mentions].reverse().find((mention) => mention.at < at);
    if (!anchor) continue;
    const from = Number(m[1]);
    candidates.push({ file: anchor.file, from, to: m[2] ? Number(m[2]) : from });
  }
  return candidates;
}

const normalize = (file: string): string => file.replace(/^\.\//, "");

/** Path-suffix-tolerant file identity (a rationale may cite a repo-relative or basename path). */
function sameFile(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

export function scoreCitationPrecision(
  rationale: string,
  evidence: CitationEvidence,
  groundTruth: GroundTruthDefectLoc,
  importGraph: ImportGraph,
): CitationScore {
  const candidates: Candidate[] = [
    ...evidence.focal_claims.map((c) => ({ file: c.file, from: c.lines[0], to: c.lines[1] })),
    ...extractCitations(rationale),
  ];
  if (candidates.length === 0) return { tier: "unaligned", no_citation: true };

  const inDefectFile = candidates.filter((c) => sameFile(c.file, groundTruth.file));
  const aligned = inDefectFile.some((c) => c.from <= groundTruth.line + 2 && c.to >= groundTruth.line - 2);
  if (aligned) return { tier: "aligned", no_citation: false };

  if (inDefectFile.length > 0) return { tier: "adjacent", no_citation: false };

  // 1-hop import set of the defect file — the Phase-3 long-cycle adjacency.
  const oneHop = [...importGraph.imports(groundTruth.file), ...importGraph.importedBy(groundTruth.file)];
  if (candidates.some((c) => oneHop.some((file) => sameFile(c.file, file)))) {
    return { tier: "adjacent", no_citation: false };
  }

  return { tier: "unaligned", no_citation: false };
}
