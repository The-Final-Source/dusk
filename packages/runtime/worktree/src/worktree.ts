import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { BEAD_ID_RE, duskError, err, formatId, ok, type RuntimeResult } from "@dusk/core-schema";

import { planWorktrees, type WorktreeGroup } from "./plan.js";
import type { BeadDag } from "@dusk/core-schema";

/**
 * Step-3 worktree orchestration (RFC §6.3). Each worktree group's first bead gets
 * an isolated `git worktree add -b dusk/<bead-id> <path> <baseRef>`; the rest of
 * the group runs sequentially in place (no second worktree). Bead-ids follow the
 * App. D.8 `bd_<14-digit-yyyymmddhhmmss><3-digit-seq>` format.
 *
 * `baseRef` is REQUIRED — callers pass the session snapshot's already-resolved
 * merge-base SHA. There is deliberately NO `origin/main` default: a fresh
 * standalone repo has no remote, and a silent default would fail OPEN (base a
 * worktree on a wrong/absent ref). Absent baseRef fails LOUD instead.
 */

export type Clock = { now: () => number };

export const WORKTREES_DIR = ".ia/runtime/worktrees";

export const newBeadId = (clock: Clock, seq: number): string => formatId("bd", clock.now(), seq);
export const branchName = (beadId: string): string => `dusk/${beadId}`;
export const worktreePathFor = (repoDir: string, beadId: string): string => join(repoDir, WORKTREES_DIR, beadId);

const git = (repoDir: string, args: string[]): string =>
  execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();

export type WorktreeHandle = { beadId: string; branch: string; path: string };

export type AddWorktreeOptions = {
  baseRef?: string;
  /** git invoker override for tests / call counting. */
  gitRunner?: (repoDir: string, args: string[]) => string;
};

/** Create one isolated worktree for a bead off the REQUIRED, caller-resolved base ref. */
export function addWorktree(repoDir: string, beadId: string, options: AddWorktreeOptions = {}): RuntimeResult<WorktreeHandle> {
  if (!BEAD_ID_RE.test(beadId)) {
    return err(duskError("worktree_creation_failed", `bead-id "${beadId}" does not match the App. D.8 format`, { recoverable: false }));
  }
  if (!options.baseRef) {
    return err(duskError("worktree_creation_failed", "addWorktree requires an explicit baseRef (the resolved merge-base SHA); there is no implicit origin/main default", { recoverable: false, bead_id: beadId }));
  }
  const baseRef = options.baseRef;
  const run = options.gitRunner ?? git;
  const branch = branchName(beadId);
  const path = worktreePathFor(repoDir, beadId);
  try {
    mkdirSync(dirname(path), { recursive: true });
    run(repoDir, ["worktree", "add", "-q", "-b", branch, path, baseRef]);
    return ok({ beadId, branch, path });
  } catch (error) {
    return err(
      duskError("worktree_creation_failed", error instanceof Error ? error.message : "git worktree add failed", {
        recoverable: false,
        bead_id: beadId,
      }),
    );
  }
}

/** Remove a bead's worktree and delete its branch. Idempotent. */
export function removeWorktree(repoDir: string, beadId: string, options: AddWorktreeOptions = {}): void {
  const run = options.gitRunner ?? git;
  const path = worktreePathFor(repoDir, beadId);
  try {
    if (existsSync(path)) run(repoDir, ["worktree", "remove", "--force", path]);
  } catch {
    /* already gone */
  }
  try {
    run(repoDir, ["branch", "-D", branchName(beadId)]);
  } catch {
    /* branch already deleted */
  }
}

export type CreatedWorktrees = {
  groups: WorktreeGroup[];
  /** Handles for the worktrees actually created (one per group's first bead). */
  handles: WorktreeHandle[];
};

/**
 * Execute the parallel/serial plan: create exactly ONE worktree per connected
 * component (the group's first bead); the remaining group members run in place.
 */
export function createWorktreesForDag(repoDir: string, dag: BeadDag, options: AddWorktreeOptions = {}): RuntimeResult<CreatedWorktrees> {
  const groups = planWorktrees(dag);
  const handles: WorktreeHandle[] = [];
  for (const group of groups) {
    const result = addWorktree(repoDir, group.worktreeBead, options);
    if (!result.success) return result;
    handles.push(result.value);
  }
  return ok({ groups, handles });
}
