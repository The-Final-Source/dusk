import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  DialogStateSchema,
  DraftIntentSchema,
  duskError,
  err,
  formatId,
  ok,
  DIALOG_ID_RE,
  type AuthorStage,
  type DialogState,
  type DraftIntent,
  type RuntimeResult,
  type TranscriptEntry,
} from "@dusk/core-schema";
import { atomicWriteFile } from "@dusk/core-parser";

/**
 * Disk-resident dialog state (design D2). Each dialog lives at
 * `.ia/runtime/dialogs/<dialog-id>/state.md` as YAML frontmatter + Markdown
 * sections mirroring Phase 2's bead-memory format. Writes are atomic
 * (temp + rename via the Phase-1 primitive); parse → serialize is byte-identical;
 * appending a turn never rewrites prior `## Turn N` bytes.
 */

export type Clock = { now: () => number };

export const DIALOGS_DIR = ".ia/runtime/dialogs";
export const DIALOG_TTL_MS = 24 * 60 * 60 * 1000;

export const dialogsDir = (rootDir: string): string => join(rootDir, DIALOGS_DIR);
export const dialogDir = (rootDir: string, dialogId: string): string => join(dialogsDir(rootDir), dialogId);
export const dialogStatePath = (rootDir: string, dialogId: string): string => join(dialogDir(rootDir, dialogId), "state.md");

/** Mint a `dlg_<14-digit-yyyymmddhhmmss><3-digit-seq>` id (App. D.8), monotonic within a Clock tick. */
export function newDialogId(rootDir: string, clock: Clock): string {
  const base = formatId("dlg", clock.now(), 0).slice(0, -3); // dlg_<ts14> prefix
  let seq = 1;
  const dir = dialogsDir(rootDir);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(base)) {
        const existing = Number(name.slice(base.length));
        if (Number.isInteger(existing) && existing >= seq) seq = existing + 1;
      }
    }
  }
  return formatId("dlg", clock.now(), seq);
}

const stageToYaml = (stage: AuthorStage): string => (stage === "4.5" ? '"4.5"' : String(stage));

const stageFromRaw = (raw: unknown): AuthorStage => {
  if (raw === "4.5" || raw === 4.5) return "4.5";
  const n = Number(raw);
  if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5) return n;
  throw new Error(`invalid stage value: ${String(raw)}`);
};

function serializeTurn(n: number, entry: TranscriptEntry): string {
  return [`## Turn ${n}`, "", `role: ${entry.role}`, `stage: ${stageToYaml(entry.stage)}`, `at: ${entry.at}`, "", `${entry.content}`, ""].join("\n");
}

/** Canonical, deterministic serialization (design D2). */
export function serializeDialogState(state: DialogState): string {
  const frontmatter = [
    `dialog_id: ${state.dialog_id}`,
    `request: ${JSON.stringify(state.request)}`,
    `current_stage: ${stageToYaml(state.current_stage)}`,
    `created_at: ${state.created_at}`,
    `last_touched_at: ${state.last_touched_at}`,
  ].join("\n");
  const drafts = state.intents_drafted.length === 0 ? "[]\n" : stringifyYaml(state.intents_drafted);
  const turns = state.transcript.map((entry, i) => `\n${serializeTurn(i + 1, entry)}`).join("");
  return `---\n${frontmatter}\n---\n\n## Intents drafted\n\n\`\`\`yaml\n${drafts}\`\`\`\n\n## Transcript\n${turns}`;
}

const TURN_RE = /\n## Turn \d+\n\n/;

/** Parse a state.md document. Round-trip with `serializeDialogState` is byte-identical. */
export function parseDialogState(raw: string): RuntimeResult<DialogState> {
  try {
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fm) return err(duskError("internal_error", "dialog state.md is missing YAML frontmatter", { recoverable: false }));
    const meta = parseYaml(fm[1]) as Record<string, unknown>;

    const draftsMatch = raw.match(/## Intents drafted\n\n```yaml\n([\s\S]*?)```\n/);
    const draftsRaw = draftsMatch ? (parseYaml(draftsMatch[1]) as unknown[]) ?? [] : [];
    const intents_drafted = (Array.isArray(draftsRaw) ? draftsRaw : []).map((d) => DraftIntentSchema.parse(d));

    const transcriptIdx = raw.indexOf("\n## Transcript\n");
    const transcript: TranscriptEntry[] = [];
    if (transcriptIdx !== -1) {
      const body = raw.slice(transcriptIdx + "\n## Transcript\n".length);
      const parts = body.split(TURN_RE);
      for (const part of parts) {
        if (part.trim().length === 0) continue;
        const m = part.match(/^role: (author|user)\nstage: (.+)\nat: (.+)\n\n([\s\S]*)\n$/);
        if (!m) return err(duskError("internal_error", "dialog transcript turn failed to parse", { recoverable: false }));
        transcript.push({ role: m[1] as "author" | "user", stage: stageFromRaw(parseYaml(m[2])), at: m[3], content: m[4] });
      }
    }

    const state = DialogStateSchema.parse({
      schema_version: 1,
      dialog_id: meta.dialog_id,
      request: meta.request,
      current_stage: stageFromRaw(meta.current_stage),
      transcript,
      intents_drafted,
      created_at: meta.created_at,
      last_touched_at: meta.last_touched_at,
    });
    return ok(state);
  } catch (error) {
    return err(duskError("internal_error", `dialog state.md failed to parse: ${(error as Error).message}`, { recoverable: false }));
  }
}

const unknownDialog = (dialogId: string) =>
  duskError("author_dialog_id_unknown", `no dialog exists for id ${dialogId}`, {
    recoverable: true,
    recovery_hint: "the dialog was finalized, GC'd, or never existed; call dusk_author_start to begin a fresh dialog",
  });

/** Atomically persist a dialog state (creates the directory on first write). */
export function writeDialogState(rootDir: string, state: DialogState): void {
  const path = dialogStatePath(rootDir, state.dialog_id);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFile(path, serializeDialogState(DialogStateSchema.parse(state)));
}

/** Read + validate a dialog state. A missing dialog is `author_dialog_id_unknown`. */
export function readDialogState(rootDir: string, dialogId: string): RuntimeResult<DialogState> {
  if (!DIALOG_ID_RE.test(dialogId)) return err(unknownDialog(dialogId));
  const path = dialogStatePath(rootDir, dialogId);
  if (!existsSync(path)) return err(unknownDialog(dialogId));
  return parseDialogState(readFileSync(path, "utf8"));
}

/** Destroy a dialog directory (finalize success / GC). Idempotent. */
export function destroyDialog(rootDir: string, dialogId: string): void {
  rmSync(dialogDir(rootDir, dialogId), { recursive: true, force: true });
}

export type DialogSummary = {
  dialog_id: string;
  request: string;
  current_stage: AuthorStage;
  created_at: string;
  last_touched_at: string;
};

/** Enumerate outstanding dialogs (the shared query behind `dusk://dialogs/active`). */
export function listDialogs(rootDir: string): DialogSummary[] {
  const dir = dialogsDir(rootDir);
  if (!existsSync(dir)) return [];
  const out: DialogSummary[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const read = readDialogState(rootDir, entry.name);
    if (!read.success) continue;
    const { dialog_id, request, current_stage, created_at, last_touched_at } = read.value;
    out.push({ dialog_id, request, current_stage, created_at, last_touched_at });
  }
  return out.sort((a, b) => (a.dialog_id < b.dialog_id ? -1 : 1));
}

/**
 * GC dialogs whose `last_touched_at` is older than 24h relative to the injected
 * Clock (`dusk doctor --gc-dialogs`). Directories without a readable state fall
 * back to filesystem mtime. Returns reaped dialog ids; idempotent.
 */
export function gcDialogs(rootDir: string, clock: Clock): string[] {
  const dir = dialogsDir(rootDir);
  if (!existsSync(dir)) return [];
  const reaped: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const read = readDialogState(rootDir, entry.name);
    const touched = read.success ? Date.parse(read.value.last_touched_at) : statSync(join(dir, entry.name)).mtimeMs;
    if (!Number.isNaN(touched) && clock.now() - touched > DIALOG_TTL_MS) {
      destroyDialog(rootDir, entry.name);
      reaped.push(entry.name);
    }
  }
  return reaped;
}

// ---- Per-dialog advisory lock (design risks: finalize/continue races). --------

const localQueues = new Map<string, Promise<unknown>>();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireFileLock(lockPath: string): Promise<boolean> {
  if (!existsSync(dirname(lockPath))) return false; // dialog gone — caller surfaces unknown-id
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      closeSync(openSync(lockPath, "wx"));
      return true;
    } catch {
      if (!existsSync(dirname(lockPath))) return false;
      await sleep(10);
    }
  }
  // Steal a stale lock (a crashed holder must not deadlock the dialog forever).
  try {
    unlinkSync(lockPath);
    closeSync(openSync(lockPath, "wx"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Serialize work against one dialog: an in-process queue (concurrent calls in
 * one harness) plus an on-disk advisory lock file (concurrent processes).
 * The loser of a race against a `finalize` reads the destroyed dialog and
 * surfaces `author_dialog_id_unknown`.
 */
export async function withDialogLock<T>(rootDir: string, dialogId: string, fn: () => Promise<T> | T): Promise<T> {
  const key = `${rootDir}::${dialogId}`;
  const prev = localQueues.get(key) ?? Promise.resolve();
  const run = prev.then(async () => {
    const lockPath = join(dialogDir(rootDir, dialogId), ".lock");
    const locked = await acquireFileLock(lockPath);
    try {
      return await fn();
    } finally {
      if (locked) {
        try {
          unlinkSync(lockPath);
        } catch {
          /* released by destroy */
        }
      }
    }
  });
  localQueues.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}
