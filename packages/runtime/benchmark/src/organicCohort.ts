import type { OrganicCohort, SubAgentTrace } from "@dusk/core-schema";

/**
 * Organic confirmation-pass cohort — Phase 5 P5-T4 (RFC §7.5.1). Production
 * confirmation calls (correlated via `confirmation_of_trace_id`) extend the
 * audit as a DISTINCT cohort whose artifact shape carries the selection-bias
 * annotations as literals — the no-blended-metrics rule enforced mechanically.
 * The curated baseline is always computed without this data.
 */
export function assembleOrganicCohort(traces: SubAgentTrace[]): OrganicCohort | undefined {
  const byOriginal = new Map<string, SubAgentTrace[]>();
  for (const trace of traces) {
    if (!trace.confirmation_of_trace_id) continue;
    const group = byOriginal.get(trace.confirmation_of_trace_id) ?? [];
    group.push(trace);
    byOriginal.set(trace.confirmation_of_trace_id, group);
  }
  if (byOriginal.size === 0) return undefined;

  const samples = [...byOriginal.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([originalId, group]) => {
      const outcome = group.map((t) => t.confirmation_pass_outcome).find((o) => o !== undefined);
      return {
        confirmation_of_trace_id: originalId,
        confirmation_trace_ids: group.map((t) => t.trace_id),
        ...(outcome ? { confirmation_pass_outcome: outcome } : {}),
      };
    });

  return {
    selection: "first-call-rejected",
    precision_not_comparable_to_curated: true,
    sample_count: samples.length,
    samples,
  };
}
