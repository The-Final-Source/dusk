import type { ApproachChannel, ApproachEntry, BeadMemory, VerifierSignal } from "./beadMemory.js";

/**
 * Mechanical, deterministic compaction (RFC §9.6.1; design D6). NEVER LLM-summarized.
 * Fires when `## Verifier signals (last 3)` exceeds three entries: keeps the most
 * recent three verbatim and folds older signals into a ROLLING SUMMARY under the
 * appropriate `## Approaches tried (impl|test-authoring)` channel — entries are
 * keyed by `(approach_label, channel)` and merged into iter RANGES, so the file
 * is bounded by the number of distinct structural approaches (the taxonomy), not
 * by iteration depth. Preserves `(triple_id, focal_verdict, slot_focus,
 * approach_label)` and drops only verbose rationale. Performs ZERO model calls.
 */
export const VERIFIER_SIGNAL_CAP = 3;

/** Parse an `attempted_at_iter` token (`"7"` or `"1-3"`) into [min, max]. */
function iterBounds(token: string): [number, number] {
  const parts = token.split("-").map((n) => Number(n.trim()));
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) return [parts[0], parts[1]];
  const single = Number(token.trim());
  return [single, single];
}

const rangeToken = (min: number, max: number): string => (min === max ? String(min) : `${min}-${max}`);

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

/** Merge a folded approach into the channel list, consolidating by label into an iter range. */
function mergeApproach(list: ApproachEntry[], folded: ApproachEntry): ApproachEntry[] {
  const idx = list.findIndex((entry) => entry.approach_label === folded.approach_label);
  if (idx === -1) return [...list, folded];

  const existing = list[idx];
  const [eMin, eMax] = iterBounds(existing.attempted_at_iter);
  const [fMin, fMax] = iterBounds(folded.attempted_at_iter);
  const merged: ApproachEntry = {
    ...folded, // keep the most-recent provenance (slot focus, triple, verdict, summary)
    attempted_at_iter: rangeToken(Math.min(eMin, fMin), Math.max(eMax, fMax)),
  };
  const next = [...list];
  next[idx] = merged;
  return next;
}

export function compact(memory: BeadMemory): BeadMemory {
  if (memory.verifier_signals.length <= VERIFIER_SIGNAL_CAP) return memory;

  const sorted = [...memory.verifier_signals].sort((a, b) => a.iter - b.iter);
  const kept = sorted.slice(sorted.length - VERIFIER_SIGNAL_CAP);
  const folded = sorted.slice(0, sorted.length - VERIFIER_SIGNAL_CAP);

  let approachesImpl = memory.approaches_impl;
  let approachesTest = memory.approaches_test_authoring;
  for (const signal of folded) {
    const entry = foldedApproach(signal);
    if (signal.channel === "test-authoring") approachesTest = mergeApproach(approachesTest, entry);
    else approachesImpl = mergeApproach(approachesImpl, entry);
  }

  return {
    ...memory,
    approaches_impl: approachesImpl,
    approaches_test_authoring: approachesTest,
    verifier_signals: kept,
    last_compacted_at_iter: kept[0]?.iter ?? memory.last_compacted_at_iter,
  };
}
