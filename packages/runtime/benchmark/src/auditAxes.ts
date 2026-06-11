import type { AuditFixtureResult, AuditAxisScores, AuditQuadrantFlag, AuditThresholds } from "@dusk/core-schema";
import type { ImportGraph } from "@dusk/runtime-long-cycle";

import { scoreCitationPrecision, type CitationEvidence, type GroundTruthDefectLoc } from "./citationPrecision.js";

/**
 * The three audit axes — RFC §7.5 / §7.5.1. All pure transforms over recorded
 * Verifier calls; the only model involvement is producing the calls themselves.
 */

export type AuditCall = {
  decision: "accept" | "reject";
  rationale: string;
  evidence: CitationEvidence;
  /** Resource usage for the benchmark's latency/cost post-pass (absent on doubles). */
  usage?: { latency_ms: number; cost_usd: number };
};

/** Axis 1 — Shannon entropy (bits) over a verdict distribution. */
export function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / total;
    h -= p * Math.log2(p);
  }
  return h;
}

const tokenize = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0));

/** Axis 2 — token-level Jaccard overlap between two rationales. */
export function tokenOverlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function meanPairwiseOverlap(rationales: string[]): number {
  if (rationales.length < 2) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < rationales.length; i += 1) {
    for (let j = i + 1; j < rationales.length; j += 1) {
      sum += tokenOverlap(rationales[i], rationales[j]);
      pairs += 1;
    }
  }
  return sum / pairs;
}

/** Per-fixture three-axis result over N independent calls. */
export function fixtureAuditResult(
  fixtureId: string,
  calls: AuditCall[],
  groundTruth: GroundTruthDefectLoc,
  importGraph: ImportGraph,
): AuditFixtureResult {
  const accept = calls.filter((c) => c.decision === "accept").length;
  const reject = calls.length - accept;
  const scores = calls.map((c) => scoreCitationPrecision(c.rationale, c.evidence, groundTruth, importGraph));
  const alignedCount = scores.filter((s) => s.tier === "aligned").length;
  return {
    fixture_id: fixtureId,
    n_calls: calls.length,
    verdict_counts: { accept, reject },
    axis1_entropy: shannonEntropy([accept, reject]),
    axis2_mean_token_overlap: meanPairwiseOverlap(calls.map((c) => c.rationale)),
    axis3_citation_tiers: scores.map((s) => s.tier),
    axis3_pct_aligned: calls.length === 0 ? 0 : alignedCount / calls.length,
    no_citation_flag: scores.some((s) => s.no_citation),
  };
}

/** A fixture meets the RFC "≥4-of-5 aligned" bar when ≥80% of its calls score `aligned`. */
const meetsAligned4of5 = (f: AuditFixtureResult): boolean => f.axis3_pct_aligned >= 0.8;
const allUnaligned = (f: AuditFixtureResult): boolean => f.axis3_citation_tiers.every((t) => t === "unaligned");

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Score the known-bad set against the pre-registered frozen bars (all three axes — never narrative judgment). */
export function scoreAxes(fixtures: AuditFixtureResult[], thresholds: AuditThresholds): AuditAxisScores {
  const meanEntropy = mean(fixtures.map((f) => f.axis1_entropy));
  const meanOverlap = mean(fixtures.map((f) => f.axis2_mean_token_overlap));
  const pctAligned4of5 = fixtures.length === 0 ? 0 : fixtures.filter(meetsAligned4of5).length / fixtures.length;
  const pctAllUnaligned = fixtures.length === 0 ? 0 : fixtures.filter(allUnaligned).length / fixtures.length;

  const axis3Pass =
    pctAligned4of5 >= thresholds.axis3_citation.min_pct_fixtures_aligned_4of5 &&
    pctAllUnaligned <= thresholds.axis3_citation.max_pct_fixtures_all_unaligned;
  const highSimilarity = meanOverlap > thresholds.axis2_similarity.max_token_overlap_low_precision_flag;

  return {
    axis1_variance: {
      mean_entropy_known_bad: meanEntropy,
      pass: meanEntropy <= thresholds.axis1_variance.max_entropy_known_bad,
    },
    axis2_similarity: {
      mean_token_overlap: meanOverlap,
      // High similarity alone is benign (calls converging on the real defect);
      // it fails only in combination with low precision — the §7.5.1 quadrant.
      pass: !(highSimilarity && !axis3Pass),
    },
    axis3_citation: {
      pct_fixtures_aligned_4of5: pctAligned4of5,
      pct_fixtures_all_unaligned: pctAllUnaligned,
      pass: axis3Pass,
    },
  };
}

/** The §7.5.1 quadrant interpretation for one audited prompt variant. */
export function quadrantFlag(variant: string, fixtures: AuditFixtureResult[], thresholds: AuditThresholds): AuditQuadrantFlag {
  const meanOverlap = mean(fixtures.map((f) => f.axis2_mean_token_overlap));
  const pctAligned4of5 = fixtures.length === 0 ? 0 : fixtures.filter(meetsAligned4of5).length / fixtures.length;
  const highSimilarity = meanOverlap > thresholds.axis2_similarity.max_token_overlap_low_precision_flag;
  const lowPrecision = pctAligned4of5 < thresholds.axis3_citation.min_pct_fixtures_aligned_4of5;
  // A Verifier that (essentially) never cites: ≥90% of fixtures all-`unaligned`
  // AND ≥90% carrying the per-fixture no-citation flag — surfaced explicitly,
  // never silently degraded. Threshold-based: a real model under a no-citation
  // prompt still leaks an occasional file:line; one leak in hundreds of calls
  // must not mask the condition.
  const pctAllUnaligned = fixtures.length === 0 ? 0 : fixtures.filter(allUnaligned).length / fixtures.length;
  const pctNoCitation = fixtures.length === 0 ? 0 : fixtures.filter((f) => f.no_citation_flag).length / fixtures.length;
  return {
    variant,
    high_similarity: highSimilarity,
    low_precision: lowPrecision,
    rubber_stamp_quadrant: highSimilarity && lowPrecision,
    no_citation_flag: pctAllUnaligned >= 0.9 && pctNoCitation >= 0.9,
  };
}
