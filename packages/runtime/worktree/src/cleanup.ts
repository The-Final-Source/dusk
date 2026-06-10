import { execFileSync } from "node:child_process";

import { BEAD_ID_RE } from "@dusk/core-schema";

import { removeWorktree } from "./worktree.js";

/**
 * Orphan-worktree reaping (`dusk doctor --cleanup-worktrees`, RFC §6.3; 4.2).
 * Lists every `dusk/<bead-id>` worktree/branch and reaps those not part of an
 * active pipeline. The standalone CLI process holds no active run, so every
 * `dusk/bd_…` worktree is an orphan from a previous (possibly crashed) run.
 * Idempotent: a second run reaps nothing.
 */

const git = (repoDir: string, args: string[]): string =>
  execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();

const isDuskBranch = (name: string): boolean => name.startsWith("dusk/") && BEAD_ID_RE.test(name.slice("dusk/".length));

/** Parse `git worktree list --porcelain` into `{ path, branch? }` blocks. */
function parseWorktrees(repoDir: string): Array<{ path: string; branch?: string }> {
  const out = git(repoDir, ["worktree", "list", "--porcelain"]);
  const blocks: Array<{ path: string; branch?: string }> = [];
  let current: { path: string; branch?: string } | undefined;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) blocks.push(current);
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/** All local `dusk/bd_*` branch names. */
function duskBranches(repoDir: string): string[] {
  const out = git(repoDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads/dusk"]);
  return out.length === 0 ? [] : out.split("\n").map((l) => l.trim()).filter(isDuskBranch);
}

/** Reap orphaned `dusk/<bead-id>` worktrees + branches. Returns reaped branch names. */
export function cleanupOrphanWorktrees(repoDir: string): string[] {
  const reaped = new Set<string>();
  for (const block of parseWorktrees(repoDir)) {
    if (block.branch && isDuskBranch(block.branch)) {
      const beadId = block.branch.slice("dusk/".length);
      removeWorktree(repoDir, beadId);
      reaped.add(block.branch);
    }
  }
  // Dangling dusk/bd_* branches whose worktree was already gone.
  for (const branch of duskBranches(repoDir)) {
    if (reaped.has(branch)) continue;
    try {
      git(repoDir, ["branch", "-D", branch]);
      reaped.add(branch);
    } catch {
      /* already deleted */
    }
  }
  return [...reaped];
}
