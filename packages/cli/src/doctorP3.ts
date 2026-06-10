import { cleanupOrphanWorktrees } from "@dusk/runtime-worktree";
import { gcCheckpoints } from "@dusk/runtime-implement-checkpoint";
import { gcDialogs } from "@dusk/runtime-author";

/**
 * Phase-3 `dusk doctor` subcommands (3.4, 4.2, 14.6). Each is idempotent and
 * exits 0 even when nothing was reaped, printing one line per reaped item.
 */

export type Clock = { now: () => number };

/** `dusk doctor --cleanup-worktrees` — reap orphaned `dusk/<bead-id>` worktrees. */
export function cleanupWorktreesCommand(root: string): { text: string; exitCode: number } {
  const reaped = cleanupOrphanWorktrees(root);
  return { text: reaped.map((b) => `reaped worktree ${b}\n`).join(""), exitCode: 0 };
}

/** `dusk doctor --gc-implement-checkpoints` — reap checkpoints older than 24h. */
export function gcCheckpointsCommand(root: string, clock: Clock): { text: string; exitCode: number } {
  const reaped = gcCheckpoints(root, clock);
  return { text: reaped.map((t) => `reaped checkpoint ${t}\n`).join(""), exitCode: 0 };
}

/** `dusk doctor --gc-dialogs` — reap dialogs whose `last_touched_at` exceeds the
 *  24h TTL, read from REAL dialog state (Phase 4 wires `dialog-state` in here;
 *  unreadable directories fall back to mtime). */
export function gcDialogsCommand(root: string, clock: Clock): { text: string; exitCode: number } {
  const reaped = gcDialogs(root, clock);
  return { text: reaped.map((d) => `reaped dialog ${d}\n`).join(""), exitCode: 0 };
}
