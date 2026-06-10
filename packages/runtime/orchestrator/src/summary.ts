import type { BeadStatus } from "./activeRun.js";

/**
 * Step-9 return summary (RFC §6.9; 11.5 / P3-T21). The machine-readable success
 * shape of `dusk_implement` — one entry per converged bead plus deduped run
 * rollups. Returned to the MCP caller (never a DuskError) on a successful run.
 */

export type CommitSummary = { bead_id: string; commit_sha: string; branch: string };
export type BeadSummaryEntry = { bead_id: string; status: BeadStatus; exit_iter: number };

export type ImplementSummary = {
  commits: CommitSummary[];
  beads_summary: BeadSummaryEntry[];
  intents_touched: string[];
  test_intents_executed: string[];
  trace_ids: string[];
  total_duration_ms: number;
  total_cost_usd: number;
  /** Advisory low-confidence supports + support-overlap warnings surfaced to the operator. */
  warnings: string[];
  low_confidence_supports: Array<{ intent_path: string; triple_id: string; rationale: string }>;
};

const dedupe = (xs: string[]): string[] => [...new Set(xs)];

export type AssembleSummaryInput = {
  commits: CommitSummary[];
  beads: BeadSummaryEntry[];
  intentsTouched: string[];
  testIntentsExecuted: string[];
  traceIds: string[];
  totalDurationMs: number;
  totalCostUsd: number;
  warnings?: string[];
  lowConfidenceSupports?: ImplementSummary["low_confidence_supports"];
};

export function assembleSummary(input: AssembleSummaryInput): ImplementSummary {
  return {
    commits: input.commits,
    beads_summary: input.beads,
    intents_touched: dedupe(input.intentsTouched),
    test_intents_executed: dedupe(input.testIntentsExecuted),
    trace_ids: dedupe(input.traceIds),
    total_duration_ms: input.totalDurationMs,
    total_cost_usd: input.totalCostUsd,
    warnings: input.warnings ?? [],
    low_confidence_supports: input.lowConfidenceSupports ?? [],
  };
}
