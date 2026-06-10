import type { ApproachEntry, BeadMemory, VerifierSignal } from "./beadMemory.js";

/**
 * Mechanical, deterministic compaction (RFC §9.6.1; design D6). NEVER LLM-summarized.
 * Fires when `## Verifier signals (last 3)` exceeds three entries: keeps the most
 * recent three verbatim and folds older signals into the appropriate
 * `## Approaches tried (impl|test-authoring)` channel, preserving
 * `(triple_id, focal_verdict, slot_focus, approach_label)` and dropping only the
 * verbose rationale. Performs ZERO model calls — it is a pure transform.
 */
export const VERIFIER_SIGNAL_CAP = 3;

function foldedApproach(signal: VerifierSignal): ApproachEntry {
  return {
    approach_label: signal.approach_label,
    attempted_at_iter: String(signal.iter),
    triple_slot_focus: signal.slot_focus,
    // Load-bearing structured facts preserved; verbose rationale dropped.
    summary: `Verifier ${signal.decision} on focal_verdict ${signal.focal_verdict}`,
    triple_id: signal.triple_id,
    focal_verdict: signal.focal_verdict,
  };
}

export function compact(memory: BeadMemory): BeadMemory {
  if (memory.verifier_signals.length <= VERIFIER_SIGNAL_CAP) return memory;

  const sorted = [...memory.verifier_signals].sort((a, b) => a.iter - b.iter);
  const kept = sorted.slice(sorted.length - VERIFIER_SIGNAL_CAP);
  const folded = sorted.slice(0, sorted.length - VERIFIER_SIGNAL_CAP);

  const appendImpl: ApproachEntry[] = [];
  const appendTest: ApproachEntry[] = [];
  for (const signal of folded) {
    (signal.channel === "test-authoring" ? appendTest : appendImpl).push(foldedApproach(signal));
  }

  return {
    ...memory,
    approaches_impl: [...memory.approaches_impl, ...appendImpl],
    approaches_test_authoring: [...memory.approaches_test_authoring, ...appendTest],
    verifier_signals: kept,
    last_compacted_at_iter: kept[0]?.iter ?? memory.last_compacted_at_iter,
  };
}
