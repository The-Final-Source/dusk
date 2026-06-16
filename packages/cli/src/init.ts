import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scaffoldProject } from "./scaffold.js";
import { mergeHook, type ConflictResolver, type MergeAction } from "./settingsMerge.js";

// `$CLAUDE_PROJECT_DIR` (not a bare relative path): Claude Code does NOT
// guarantee the hook's cwd is the project root, so a relative command can
// silently fail to resolve → the gate fails OPEN again. The documented
// project-root placeholder is cwd-independent AND git-safe (no absolute machine
// path baked into a committed settings.json). checkHook expands it against root.
// This portable form assumes the gate package is reachable under the project's
// own node_modules — true for a dusk-monorepo package, FALSE for an external
// standalone repo (see computeHookCommand).
export const DEFAULT_HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/node_modules/@dusk/pre-tool-use/dist/cli.js"';

/**
 * Resolve the installed gate CLI to an absolute path from THIS package's own
 * location (cwd-independent), via the pnpm node_modules symlink beside the
 * compiled CLI. Returns null if it cannot be found.
 */
function resolveGateCli(): string | null {
  try {
    const cliPkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const candidate = join(cliPkgRoot, "node_modules/@dusk/pre-tool-use/dist/cli.js");
    return existsSync(candidate) ? realpathSync(candidate) : null;
  } catch {
    return null;
  }
}

/**
 * The PreToolUse hook command for a target repo. For a dusk-monorepo package the
 * gate is reachable under `<root>/node_modules`, so use the portable, git-safe
 * `$CLAUDE_PROJECT_DIR` form. For an EXTERNAL standalone repo (no `@dusk/*` in
 * its node_modules — e.g. the greenfield POC) that form resolves to a
 * nonexistent path and the gate fails open; bake the absolute path to the
 * installed gate instead so the hook resolves at all. (Phase 6 / RFC §4.6 — the
 * external-repo gate-resolution fix surfaced by the greenfield de-risk.)
 */
export function computeHookCommand(root: string): string {
  const inRepoGate = join(root, "node_modules/@dusk/pre-tool-use/dist/cli.js");
  if (existsSync(inRepoGate)) return DEFAULT_HOOK_COMMAND;
  const abs = resolveGateCli();
  return abs ? `node ${JSON.stringify(abs)}` : DEFAULT_HOOK_COMMAND;
}

export type InitOptions = { hookCommand?: string; conflictResolver?: ConflictResolver };
export type InitResult = { action: MergeAction; settingsPath: string };

const alwaysAppend: ConflictResolver = () => "append";

/** Scaffold the project and install the PreToolUse gate idempotently (never silently clobbering). */
export function initProject(root: string, options: InitOptions = {}): InitResult {
  scaffoldProject(root);

  const settingsPath = join(root, ".claude/settings.json");
  const existing: Record<string, unknown> = existsSync(settingsPath)
    ? (JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>)
    : {};

  const result = mergeHook(existing, options.hookCommand ?? computeHookCommand(root), options.conflictResolver ?? alwaysAppend);
  if (result.action === "aborted") return { action: "aborted", settingsPath };

  if (result.backup) writeFileSync(`${settingsPath}.bak`, `${JSON.stringify(result.backup, null, 2)}\n`, "utf8");
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(result.settings, null, 2)}\n`, "utf8");
  return { action: result.action, settingsPath };
}
