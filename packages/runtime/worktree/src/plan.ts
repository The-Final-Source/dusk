import type { BeadDag } from "@dusk/core-schema";

/**
 * Parallel/serial decision (RFC §6.3; P3-T23). Beads linked by ANY edge
 * (typed-dependency or file-overlap serialization) form a connected component
 * that runs SEQUENTIALLY IN PLACE in a single worktree — no second `git worktree
 * add` on the shared file region. Independent beads (singleton components) each
 * get their OWN isolated worktree. Within a component, beads run in topological
 * order (a dependency/serialization edge `from → to` means `to` runs first).
 */

export type WorktreeGroup = {
  /** The bead whose worktree the whole group shares (the topological-first bead). */
  worktreeBead: string;
  /** All beads in the component, in topological order (the worktreeBead is first). */
  beads: string[];
};

/** Connected components over the UNDIRECTED edge graph (any edge serializes a pair). */
function connectedComponents(dag: BeadDag): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const node of dag.nodes) parent.set(node.bead_id, node.bead_id);
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const edge of dag.edges) {
    if (parent.has(edge.from) && parent.has(edge.to)) union(edge.from, edge.to);
  }
  const groups = new Map<string, string[]>();
  for (const node of dag.nodes) {
    const root = find(node.bead_id);
    const list = groups.get(root) ?? [];
    list.push(node.bead_id);
    groups.set(root, list);
  }
  return [...groups.values()];
}

/** Topological order within a component (Kahn); `from → to` ⇒ `to` precedes `from`. */
function topoOrder(beads: string[], dag: BeadDag): string[] {
  const set = new Set(beads);
  const indeg = new Map<string, number>(beads.map((b) => [b, 0]));
  const succ = new Map<string, string[]>(beads.map((b) => [b, []]));
  for (const edge of dag.edges) {
    if (!set.has(edge.from) || !set.has(edge.to)) continue;
    // edge from→to: `to` must run before `from`. Treat `to` as predecessor of `from`.
    succ.get(edge.to)!.push(edge.from);
    indeg.set(edge.from, (indeg.get(edge.from) ?? 0) + 1);
  }
  // Stable: process zero-indegree beads in their original (DAG ordinal) order.
  const queue = beads.filter((b) => (indeg.get(b) ?? 0) === 0);
  const out: string[] = [];
  while (queue.length > 0) {
    const b = queue.shift()!;
    out.push(b);
    for (const next of succ.get(b) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if ((indeg.get(next) ?? 0) === 0) queue.push(next);
    }
  }
  // Any remaining (cycle — shouldn't happen on a DAG) appended in original order.
  for (const b of beads) if (!out.includes(b)) out.push(b);
  return out;
}

/** Group the DAG into worktree groups: one worktree per connected component. */
export function planWorktrees(dag: BeadDag): WorktreeGroup[] {
  return connectedComponents(dag).map((component) => {
    const ordered = topoOrder(component, dag);
    return { worktreeBead: ordered[0], beads: ordered };
  });
}
