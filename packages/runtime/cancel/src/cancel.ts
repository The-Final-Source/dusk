import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { duskError, type CancelResult, type DuskError } from "@dusk/core-schema";
import { deleteCheckpoint } from "@dusk/runtime-implement-checkpoint";
import { removeWorktree } from "@dusk/runtime-worktree";

/**
 * The cancel cleanup + partitioning pass (RFC §10.1.2; design D9; 12.2–12.5).
 * After the drain, cleanup runs in a FIXED order — dialogs → checkpoints → bead
 * memory → worktrees-with-no-commits — and the result partitions every bead into
 * `cancelled` (reaped) vs `preserved`. Worktrees WITH commits are kept as
 * `partial_commits[]` (branch + worktree retained for the user's decision);
 * already-merged work is kept as `already_committed[]`.
 */

export type GitRunner = (cwd: string, args: string[]) => string;
const defaultGit: GitRunner = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

export type MergedBead = { bead_id: string; commit_sha: string };

export type CancelTargets = {
  beadIds: string[];
  mergedBeads?: MergedBead[];
  dialogIds?: string[];
  checkpointTokens?: string[];
};

export type CleanupStep = { step: "dialog" | "checkpoint" | "bead_memory" | "worktree"; target: string };

export type RunCancelInput = {
  rootDir: string;
  reason: string;
  targets: CancelTargets;
  /** Task calls that ran to completion during the drain (the orchestrator counts them). */
  inFlightTasksDrained: number;
  traceId: string;
  drainDurationMs: number;
  gitRunner?: GitRunner;
  onCleanupStep?: (event: CleanupStep) => void;
};

export type RunCancelOutput = { result: CancelResult; informational?: DuskError };

export function runCancel(input: RunCancelInput): RunCancelOutput {
  const git = input.gitRunner ?? defaultGit;
  const step = (event: CleanupStep): void => input.onCleanupStep?.(event);
  const merged = input.targets.mergedBeads ?? [];
  const mergedIds = new Set(merged.map((m) => m.bead_id));

  // Classify non-merged beads: commits → preserve as partial_commits; empty → reap.
  const partial_commits: CancelResult["cancelled"]["partial_commits"] = [];
  const emptyBeads: string[] = [];
  for (const beadId of input.targets.beadIds) {
    if (mergedIds.has(beadId)) continue;
    const branch = `dusk/${beadId}`;
    let ahead = 0;
    try {
      ahead = Number(git(input.rootDir, ["rev-list", "--count", `main..${branch}`]));
    } catch {
      continue; // branch absent — nothing to reap
    }
    if (ahead > 0) {
      partial_commits.push({ bead_id: beadId, branch, commit_sha: git(input.rootDir, ["rev-parse", branch]) });
    } else {
      emptyBeads.push(beadId);
    }
  }

  // Ordered cleanup: dialogs → checkpoints → bead memory → worktrees-no-commits.
  const cancelled_dialogs: string[] = [];
  for (const dialogId of input.targets.dialogIds ?? []) {
    rmSync(join(input.rootDir, ".ia/runtime/dialogs", dialogId), { recursive: true, force: true });
    step({ step: "dialog", target: dialogId });
    cancelled_dialogs.push(dialogId);
  }
  const cancelled_checkpoints: string[] = [];
  for (const token of input.targets.checkpointTokens ?? []) {
    deleteCheckpoint(input.rootDir, token);
    step({ step: "checkpoint", target: token });
    cancelled_checkpoints.push(token);
  }
  const bead_memories_deleted: string[] = [];
  for (const beadId of emptyBeads) {
    rmSync(join(input.rootDir, ".ia/runtime/beads", beadId), { recursive: true, force: true });
    step({ step: "bead_memory", target: beadId });
    bead_memories_deleted.push(beadId);
  }
  const cancelled_worktrees: string[] = [];
  for (const beadId of emptyBeads) {
    removeWorktree(input.rootDir, beadId, { gitRunner: (cwd, args) => git(cwd, args) });
    step({ step: "worktree", target: `dusk/${beadId}` });
    cancelled_worktrees.push(`dusk/${beadId}`);
  }

  const result: CancelResult = {
    cancelled: { cancelled_worktrees, partial_commits, cancelled_dialogs, cancelled_checkpoints, bead_memories_deleted },
    preserved: {
      already_committed: merged.map((m) => ({ bead_id: m.bead_id, commit_sha: m.commit_sha })),
      in_flight_tasks_drained: input.inFlightTasksDrained,
    },
    trace_id: input.traceId,
    drain_duration_ms: input.drainDurationMs,
  };

  // A targeted, already-merged bead is informational ("nothing to cancel here").
  let informational: DuskError | undefined;
  if (input.targets.beadIds.length === 1 && mergedIds.has(input.targets.beadIds[0])) {
    informational = duskError("cancellation_already_committed", `bead ${input.targets.beadIds[0]} is already merged to main`, {
      recoverable: false,
      bead_id: input.targets.beadIds[0],
      recovery_hint: "the work has already landed; nothing to cancel",
    });
  }

  return { result, informational };
}
