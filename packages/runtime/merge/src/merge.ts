import { execFileSync } from "node:child_process";

import { duskError, err, ok, type BeadDag, type RuntimeResult } from "@dusk/core-schema";
import { worktreePathFor } from "@dusk/runtime-worktree";

import { topoOrder } from "./topo.js";

/**
 * Step-8 worktree merge (RFC §6.8; design D11; 11.2 / P3-T20). Walks the bead DAG
 * in topological order and lands each `dusk/<bead-id>` branch on main, removing
 * its worktree + branch after a successful land. A genuine conflict surfaces as
 * `merge_conflict_unresolvable` (the decorator-aware Conflict Resolver engages on
 * decorated regions; equal-specificity ties leave TODO markers for human review).
 */

export type GitRunner = (cwd: string, args: string[]) => string;

const defaultGit: GitRunner = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

export type MergeInput = {
  repoDir: string;
  dag: BeadDag;
  gitRunner?: GitRunner;
};

export type MergeResult = {
  /** Beads rebased/landed, in topological order. */
  rebasedOrder: string[];
  /** Branches whose worktrees were removed after landing. */
  removedWorktrees: string[];
};

export function runMerge(input: MergeInput): RuntimeResult<MergeResult> {
  const git = input.gitRunner ?? defaultGit;
  const order = topoOrder(input.dag);
  const removed: string[] = [];

  for (const beadId of order) {
    const branch = `dusk/${beadId}`;
    try {
      // Land the bead's commit on main (topologically; main advances each step).
      git(input.repoDir, ["merge", "--no-edit", branch]);
    } catch (error) {
      // Abort the in-progress merge and surface for Conflict-Resolver handling.
      try {
        git(input.repoDir, ["merge", "--abort"]);
      } catch {
        /* nothing to abort */
      }
      return err(
        duskError("merge_conflict_unresolvable", `rebase of ${branch} onto main conflicted`, {
          recoverable: false,
          bead_id: beadId,
          step: 8,
          details: { branch, cause: error instanceof Error ? error.message : "merge failed" },
        }),
      );
    }
    // Remove the worktree, then delete the now-merged branch.
    const path = worktreePathFor(input.repoDir, beadId);
    try {
      git(input.repoDir, ["worktree", "remove", "--force", path]);
    } catch {
      /* already removed */
    }
    try {
      git(input.repoDir, ["branch", "-D", branch]);
    } catch {
      /* already gone */
    }
    removed.push(branch);
  }

  return ok({ rebasedOrder: order, removedWorktrees: removed });
}
