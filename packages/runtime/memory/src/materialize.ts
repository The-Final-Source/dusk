import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Four memory scopes (RFC §9.6). The runtime materializes the named scope into
 * a rendered block at spawn time; a missing file renders the EMPTY block (never
 * an error). `none` always renders empty — the structural guarantee that the
 * Verifier never sees bead state (diagnosis no-leak, §3.5).
 */
export const MEMORY_SCOPES = ["none", "bead", "dialog", "session"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export type MemoryIds = { beadId?: string; dialogId?: string; sessionId?: string };

export type MaterializeParams = {
  rootDir: string;
  scope: MemoryScope;
  role: string;
  ids?: MemoryIds;
};

export type MaterializedMemory = {
  /** The rendered block injected into the assembled prompt (empty string = empty block). */
  rendering: string;
  /** The backing file path (null for `none` or when ids are insufficient). */
  path: string | null;
  exists: boolean;
};

/** Resolve the backing file for a scope, or null when the scope is `none`/ids missing. */
export function memoryFilePath(rootDir: string, scope: MemoryScope, role: string, ids: MemoryIds = {}): string | null {
  switch (scope) {
    case "none":
      return null;
    case "bead":
      return ids.beadId ? join(rootDir, ".ia/runtime/beads", ids.beadId, `${role}.md`) : null;
    case "dialog":
      return ids.dialogId ? join(rootDir, ".ia/runtime/dialogs", ids.dialogId, `${role}.md`) : null;
    case "session":
      return join(rootDir, ".ia/runtime/session", `${role}.md`);
  }
}

/** Read the named scope into a rendered block. `none` and missing files render empty. */
export function materializeMemory(params: MaterializeParams): MaterializedMemory {
  const { rootDir, scope, role, ids = {} } = params;
  if (scope === "none") return { rendering: "", path: null, exists: false };

  const path = memoryFilePath(rootDir, scope, role, ids);
  if (!path || !existsSync(path)) return { rendering: "", path, exists: false };

  const content = readFileSync(path, "utf8");
  return { rendering: content, path, exists: true };
}

export type WriteBackParams = {
  rootDir: string;
  scope: MemoryScope;
  role: string;
  content: string;
  ids?: MemoryIds;
};

/** Persist memory for a writable scope. Creates parent dirs. `none` is a no-op (returns null). */
export function writeBackMemory(params: WriteBackParams): string | null {
  const { rootDir, scope, role, content, ids = {} } = params;
  if (scope === "none") return null;
  const path = memoryFilePath(rootDir, scope, role, ids);
  if (!path) return null;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}
