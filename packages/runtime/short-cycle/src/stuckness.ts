/**
 * Stuckness detector predicate (RFC §6.4.2; design D6; 6.3). A PURE function over
 * the per-iteration failing-triple sets. Fires when, across the last three
 * iterations (K-2, K-1, K), `verdict_delta_from_prior == ∅` AND the
 * `failing_triple_set` is identical — i.e. the three most recent iterations share
 * one non-empty failing-triple set (no progress). The empty-set case is
 * convergence, not stuckness, so it never fires.
 */

const sameSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
};

/**
 * @param failingSets per-iteration failing-triple-id sets, in iteration order
 *   (index 0 = iter 1). Returns true iff the LAST three are identical + non-empty.
 */
export function stucknessFiredAt(failingSets: string[][]): boolean {
  const n = failingSets.length;
  if (n < 3) return false;
  const a = failingSets[n - 3];
  const b = failingSets[n - 2];
  const c = failingSets[n - 1];
  if (c.length === 0) return false; // converged, not stuck
  return sameSet(a, c) && sameSet(b, c);
}
