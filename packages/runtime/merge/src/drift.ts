/**
 * `Partial: true`-aware snapshot-drift detection (RFC §6.8; design D11; 11.3).
 * On rebase, main's decoration set is compared against
 * (session-snapshot ∪ this branch's expected additions). A decoration on main
 * the snapshot doesn't know about — and that isn't an expected branch addition —
 * is drift. When the bead's commit is `Partial: true`, its deferred-intent
 * additions are folded into the expected set so they do NOT trigger a warning.
 */

export type DecorationKey = string; // e.g. `file:line:intent_path`

export type DriftWarning = { kind: "snapshot_drift"; decoration: DecorationKey };

export type DriftInput = {
  /** Decoration keys present on main after the rebase. */
  mainDecorations: DecorationKey[];
  /** Decoration keys the session snapshot knew about. */
  snapshotDecorations: DecorationKey[];
  /** Decoration keys this branch is expected to add. */
  branchExpectedAdditions: DecorationKey[];
  /** Whether the commit carried `Partial: true`. */
  partial?: boolean;
  /** Deferred-intent decoration keys (folded into expected when `partial`). */
  deferredAdditions?: DecorationKey[];
};

export function detectDrift(input: DriftInput): DriftWarning[] {
  const expected = new Set<DecorationKey>([...input.snapshotDecorations, ...input.branchExpectedAdditions]);
  if (input.partial) for (const d of input.deferredAdditions ?? []) expected.add(d);
  return input.mainDecorations.filter((d) => !expected.has(d)).map((decoration) => ({ kind: "snapshot_drift", decoration }));
}
