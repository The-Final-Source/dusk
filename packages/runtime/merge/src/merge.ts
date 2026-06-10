import { execFileSync } from "node:child_process";

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { duskError, err, ok, type BeadDag, type RuntimeResult } from "@dusk/core-schema";
import { worktreePathFor } from "@dusk/runtime-worktree";

import { resolveConflictedFiles } from "./resolveConflict.js";
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
    // Serialized beads share their group's worktree/branch — only the group's
    // representative branch exists. Skip beads with no branch of their own.
    try {
      git(input.repoDir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    } catch {
      continue;
    }
    try {
      // Land the bead's commit on main (topologically; main advances each step).
      git(input.repoDir, ["merge", "--no-edit", branch]);
    } catch {
      // Real conflict: spawn the decorator-aware Conflict Resolver (RFC §6.8).
      const conflictedFiles = git(input.repoDir, ["diff", "--name-only", "--diff-filter=U"]).split("\n").map((l) => l.trim()).filter(Boolean);
      const resolutions = resolveConflictedFiles(input.repoDir, conflictedFiles, git);
      const ties = resolutions.filter((r) => r.kind === "tie");
      if (ties.length > 0) {
        // Equal-specificity ties become TODO markers; the merge fails for human review.
        for (const tie of ties) if (tie.kind === "tie") writeFileSync(join(input.repoDir, tie.file), `${tie.todo}\n`, "utf8");
        return err(
          duskError("merge_conflict_unresolvable", `equal-specificity decoration conflict rebasing ${branch}; TODO markers written for human review`, {
            recoverable: false,
            bead_id: beadId,
            step: 8,
            details: { branch, tie_files: ties.map((t) => t.file) },
          }),
        );
      }
      // Every conflict had a more-specific winner — resolve and complete the merge.
      for (const r of resolutions) {
        if (r.kind !== "prefer") continue;
        git(input.repoDir, ["checkout", r.side === "ours" ? "--ours" : "--theirs", "--", r.file]);
        git(input.repoDir, ["add", "--", r.file]);
      }
      try {
        git(input.repoDir, ["commit", "--no-edit"]);
      } catch (commitError) {
        try {
          git(input.repoDir, ["merge", "--abort"]);
        } catch {
          /* nothing to abort */
        }
        return err(
          duskError("merge_conflict_unresolvable", `could not complete the decorator-resolved merge of ${branch}`, {
            recoverable: false,
            bead_id: beadId,
            step: 8,
            details: { branch, cause: commitError instanceof Error ? commitError.message : "commit failed" },
          }),
        );
      }
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
