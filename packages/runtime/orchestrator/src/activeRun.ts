import type { DerivedIndex } from "@dusk/core-index";

import { crossBeadView, type BeadDelta } from "./beadDelta.js";
import type { SessionSnapshot } from "./snapshot.js";

/**
 * In-process active-run registry (design D1; RFC §10.1). `dusk_implement` is an
 * MCP tool, so it runs in the MCP server process; the read-path tools
 * (`dusk_inspect` / `dusk_status` / `dusk_list_beads`) read the active run from
 * here. Read-path queries always go through {@link snapshotIndex} — the SNAPSHOT,
 * never a bead's in-flight delta (P3-T1; the §2.3 / §14.3 invariant).
 */

export const BEAD_STATUSES = [
  "decomposing",
  "short_cycle",
  "long_cycle",
  "test_execution",
  "committing",
  "merging",
  "paused_livelock",
  "paused_recovery_ladder",
  // RFC App. D.34 — the finite infrastructure-recovery axis exhausted: a
  // legible, resumable pause (NOT a content fail, a silent green, or a crash).
  "paused_infrastructure",
  "cancelled",
  "done",
] as const;
export type BeadStatus = (typeof BEAD_STATUSES)[number];

export type BeadSummary = {
  id: string;
  status: BeadStatus;
  /** Human-readable current pipeline step, e.g. `Step 4 — short cycle`. */
  current_step: string;
  started_at: string;
  branch: string;
};

export type ActiveRun = {
  sessionId: string;
  snapshot: SessionSnapshot;
  beads: Map<string, BeadSummary>;
  /** Per-bead deltas, keyed by bead-id (never consulted by the read path). */
  deltas: Map<string, BeadDelta>;
};

let current: ActiveRun | undefined;

export function startActiveRun(sessionId: string, snapshot: SessionSnapshot): ActiveRun {
  current = { sessionId, snapshot, beads: new Map(), deltas: new Map() };
  return current;
}

export const getActiveRun = (): ActiveRun | undefined => current;

export function endActiveRun(): void {
  current = undefined;
}

export function upsertBead(run: ActiveRun, summary: BeadSummary): void {
  run.beads.set(summary.id, summary);
}

export function setBeadStatus(run: ActiveRun, beadId: string, status: BeadStatus, currentStep: string): void {
  const bead = run.beads.get(beadId);
  if (bead) run.beads.set(beadId, { ...bead, status, current_step: currentStep });
}

/** The read-path index for the active run: the SNAPSHOT only (excludes bead deltas). */
export function snapshotIndex(run: ActiveRun): DerivedIndex {
  return crossBeadView(run.snapshot);
}

/** Active bead summaries (empty when no run is in flight). */
export function activeBeadSummaries(): BeadSummary[] {
  return current ? [...current.beads.values()] : [];
}
