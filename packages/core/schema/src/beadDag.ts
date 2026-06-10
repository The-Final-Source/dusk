/**
 * The bead DAG (RFC §6.2; design D2). Produced by the Decomposer (Step 2),
 * consumed by the worktree orchestrator (Step 3, parallel/serial decision) and
 * the merge step (Step 8, topological rebase order). Pinned in the leaf so those
 * packages share one definition without a cycle. Edges combine three orthogonal
 * sources (typed `relates_to` + file-overlap serialization + claim-overlap
 * precondition); claim-overlap conflicts abort before the DAG is issued, so only
 * the first two edge sources appear on a successfully-built DAG.
 */

export const BEAD_EDGE_SOURCES = ["typed-relates-to", "file-overlap"] as const;
export type BeadEdgeSource = (typeof BEAD_EDGE_SOURCES)[number];

/** A directed edge `from → to` meaning `from` depends on / serializes after `to`. */
export type BeadEdge = {
  from: string;
  to: string;
  source: BeadEdgeSource;
  /** For `typed-relates-to`: the underlying `RelatesTo.kind` (`implies` / `parent` / …). */
  kind?: string;
};

export type BeadNode = {
  bead_id: string;
  /** The intents in this bead's scope (the directly-touched + auto-added set). */
  intent_paths: string[];
  /** Files the bead is predicted to claim (snapshot-derived; drives file-overlap edges). */
  predicted_files: string[];
};

export type BeadDag = {
  nodes: BeadNode[];
  edges: BeadEdge[];
};

/** Advisory support-overlap warning surfaced in the run summary (non-blocking). */
export type SupportOverlapWarning = {
  kind: "support_overlap";
  beads: [string, string];
  file: string;
  message: string;
};
