/**
 * App. D.8 id formats. Ids are `<prefix>_<14-digit-yyyymmddhhmmss><3-digit-seq>`
 * (UTC), Clock-injected and deterministic given (epochMs, seq). Pure formatting
 * lives here in the leaf so the checkpoint (`rt_`) and worktree (`bd_`) packages
 * share one definition.
 */

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** 14-digit UTC `yyyymmddhhmmss` for an epoch-ms instant. */
export function timestamp14(epochMs: number): string {
  const d = new Date(epochMs);
  return (
    `${pad(d.getUTCFullYear(), 4)}` +
    `${pad(d.getUTCMonth() + 1)}` +
    `${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}` +
    `${pad(d.getUTCMinutes())}` +
    `${pad(d.getUTCSeconds())}`
  );
}

/** `<prefix>_<14-digit-ts><3-digit-seq>` (App. D.8). */
export function formatId(prefix: string, epochMs: number, seq: number): string {
  return `${prefix}_${timestamp14(epochMs)}${pad(seq, 3)}`;
}

export const RESUME_TOKEN_RE = /^rt_[0-9]{14}[0-9]{3}$/;
export const BEAD_ID_RE = /^bd_[0-9]{14}[0-9]{3}$/;

export const isResumeToken = (value: string): boolean => RESUME_TOKEN_RE.test(value);
export const isBeadId = (value: string): boolean => BEAD_ID_RE.test(value);
