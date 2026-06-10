import type { BeadDag } from "@dusk/core-schema";

/**
 * Topological order over the bead DAG for Step-8 rebase (RFC §6.8; P3-T20). An
 * edge `from → to` means `from` depends on / serializes after `to`, so `to`
 * rebases first. Independent beads may interleave but a dependency is never
 * violated. Stable in DAG-ordinal order among ready beads.
 */
export function topoOrder(dag: BeadDag): string[] {
  const ids = dag.nodes.map((n) => n.bead_id);
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]));
  const set = new Set(ids);
  for (const e of dag.edges) {
    if (!set.has(e.from) || !set.has(e.to)) continue;
    succ.get(e.to)!.push(e.from); // `to` precedes `from`
    indeg.set(e.from, (indeg.get(e.from) ?? 0) + 1);
  }
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const out: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    for (const next of succ.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if ((indeg.get(next) ?? 0) === 0) queue.push(next);
    }
  }
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}
