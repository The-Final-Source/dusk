import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";

import type { SessionSnapshot } from "./snapshot.js";

/**
 * Per-bead in-memory delta (RFC §2.10; design D1; P3-T1). A `BeadDelta` records
 * the decoration writes a bead's Engineer has performed in its worktree but NOT
 * yet merged. The layered query model:
 *   - a bead's OWN Verifier / Test-Runner / Bead-Orchestrator queries see
 *     `snapshot ∪ beadDelta`  (via {@link sameBeadView});
 *   - cross-bead queries (Decomposer file-overlap, long-cycle universe,
 *     focal/support overlap precondition) see the snapshot ONLY
 *     (via {@link crossBeadView}).
 * Both views expose the unchanged Phase-1 D6 `DerivedIndex` query interface —
 * only the backing record set differs.
 */

export type BeadDelta = {
  beadId: string;
  records: DecorationRecord[];
  /** Record a decoration write the bead's Engineer performed. */
  add: (record: DecorationRecord) => void;
};

export function createBeadDelta(beadId: string): BeadDelta {
  const records: DecorationRecord[] = [];
  return {
    beadId,
    records,
    add: (record: DecorationRecord) => {
      records.push(record);
    },
  };
}

/** Same-bead view: snapshot ∪ this bead's in-flight delta (re-derives the index). */
export function sameBeadView(snapshot: SessionSnapshot, delta: BeadDelta): DerivedIndex {
  if (delta.records.length === 0) return snapshot.index;
  return buildDerivedIndex([...snapshot.index.records, ...delta.records], snapshot.index.intents);
}

/** Cross-bead view: the frozen snapshot only (a bead's delta is invisible to peers). */
export function crossBeadView(snapshot: SessionSnapshot): DerivedIndex {
  return snapshot.index;
}
