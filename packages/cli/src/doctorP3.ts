import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { cleanupOrphanWorktrees } from "@dusk/runtime-worktree";
import { gcCheckpoints } from "@dusk/runtime-implement-checkpoint";

/**
 * Phase-3 `dusk doctor` subcommands (3.4, 4.2, 14.6). Each is idempotent and
 * exits 0 even when nothing was reaped, printing one line per reaped item.
 */

export type Clock = { now: () => number };
const DIALOG_TTL_MS = 24 * 60 * 60 * 1000;

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

/** `dusk doctor --gc-dialogs` — reap dialog directories older than 24h (by mtime). */
export function gcDialogsCommand(root: string, clock: Clock): { text: string; exitCode: number } {
  const dialogsDir = join(root, ".ia/runtime/dialogs");
  if (!existsSync(dialogsDir)) return { text: "", exitCode: 0 };
  const reaped: string[] = [];
  for (const entry of readdirSync(dialogsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(dialogsDir, entry.name);
    if (clock.now() - statSync(full).mtimeMs > DIALOG_TTL_MS) {
      rmSync(full, { recursive: true, force: true });
      reaped.push(entry.name);
    }
  }
  return { text: reaped.map((d) => `reaped dialog ${d}\n`).join(""), exitCode: 0 };
}
