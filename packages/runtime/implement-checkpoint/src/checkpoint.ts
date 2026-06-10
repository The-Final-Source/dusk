import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  ImplementCheckpointSchema,
  duskError,
  err,
  formatId,
  ok,
  type ImplementCheckpoint,
  type RuntimeResult,
} from "@dusk/core-schema";

/**
 * Disk-resident pause/resume checkpoints (RFC §10.1.1; design D4). Files live at
 * `.ia/runtime/implement/<resume_token>.json`. The JSON shape is the FROZEN
 * `ImplementCheckpoint` from `@dusk/core-schema` (Phase 4 consumes it). Writes are
 * atomic (temp + rename); checkpoints are single-use (deleted on Step-1
 * transition) with a 24h TTL read off an injected Clock.
 */

export type Clock = { now: () => number };

export const CHECKPOINT_DIR = ".ia/runtime/implement";
export const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;

export const checkpointDir = (rootDir: string): string => join(rootDir, CHECKPOINT_DIR);
export const checkpointPath = (rootDir: string, token: string): string => join(checkpointDir(rootDir), `${token}.json`);

/** Mint a `rt_<14-digit-yyyymmddhhmmss><3-digit-seq>` token (App. D.8). */
export const newResumeToken = (clock: Clock, seq: number): string => formatId("rt", clock.now(), seq);

/** Atomically write a checkpoint; returns its path. Validates against the frozen schema. */
export function writeCheckpoint(rootDir: string, token: string, checkpoint: ImplementCheckpoint): string {
  const path = checkpointPath(rootDir, token);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(ImplementCheckpointSchema.parse(checkpoint), null, 2), "utf8");
  renameSync(tmp, path);
  return path;
}

/** Delete a checkpoint (single-use consumption / cancel cleanup). Idempotent. */
export function deleteCheckpoint(rootDir: string, token: string): void {
  rmSync(checkpointPath(rootDir, token), { force: true });
}

/** Read + validate a checkpoint by token. Missing file is treated as expiry. */
export function readCheckpoint(rootDir: string, token: string): RuntimeResult<ImplementCheckpoint> {
  const path = checkpointPath(rootDir, token);
  if (!existsSync(path)) {
    return err(
      duskError("implement_resume_token_expired", `no checkpoint exists for resume token ${token}`, {
        recoverable: false,
        recovery_hint: "the checkpoint was already consumed or never existed; re-issue the original request",
      }),
    );
  }
  const parsed = ImplementCheckpointSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    return err(duskError("internal_error", `checkpoint ${token} failed schema validation`, { recoverable: false }));
  }
  return ok(parsed.data);
}

/** Whether a checkpoint's `last_touched_at` is older than the 24h TTL relative to the Clock. */
export function isExpired(checkpoint: ImplementCheckpoint, clock: Clock): boolean {
  const touched = Date.parse(checkpoint.last_touched_at);
  if (Number.isNaN(touched)) return false;
  return clock.now() - touched > CHECKPOINT_TTL_MS;
}

/**
 * Load a checkpoint for resume: missing → expired; aged past 24h → expired with
 * `original_request` quoted in `recovery_hint` (P3-T7). The caller deletes the
 * checkpoint on a successful Step-1 transition (single-use, P3-T6).
 */
export function loadForResume(rootDir: string, token: string, clock: Clock): RuntimeResult<ImplementCheckpoint> {
  const read = readCheckpoint(rootDir, token);
  if (!read.success) return read;
  if (isExpired(read.value, clock)) {
    return err(
      duskError("implement_resume_token_expired", `resume token ${token} expired (24h TTL)`, {
        recoverable: false,
        recovery_hint: `re-issue the original request: "${read.value.original_request}"`,
      }),
    );
  }
  return read;
}

/** List every outstanding checkpoint (read-surface enumeration; §14.2). */
export function listCheckpoints(rootDir: string): Array<{ token: string; checkpoint: ImplementCheckpoint }> {
  const dir = checkpointDir(rootDir);
  if (!existsSync(dir)) return [];
  const out: Array<{ token: string; checkpoint: ImplementCheckpoint }> = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const token = name.slice(0, -".json".length);
    const read = readCheckpoint(rootDir, token);
    if (read.success) out.push({ token, checkpoint: read.value });
  }
  return out;
}

/**
 * GC stale checkpoints (`dusk doctor --gc-implement-checkpoints`, 3.4). Deletes
 * every checkpoint older than the 24h TTL; returns the reaped tokens. Idempotent.
 */
export function gcCheckpoints(rootDir: string, clock: Clock): string[] {
  const reaped: string[] = [];
  for (const { token, checkpoint } of listCheckpoints(rootDir)) {
    if (isExpired(checkpoint, clock)) {
      deleteCheckpoint(rootDir, token);
      reaped.push(token);
    }
  }
  return reaped;
}

/** Build the naive Phase-3 `suggested_dialog_seed` (design D4: raw join of refs). */
export const suggestedDialogSeed = (unresolvedRefs: string[]): string => unresolvedRefs.join(", ");
