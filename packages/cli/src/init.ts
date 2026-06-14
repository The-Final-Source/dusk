import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { scaffoldProject } from "./scaffold.js";
import { mergeHook, type ConflictResolver, type MergeAction } from "./settingsMerge.js";

// `$CLAUDE_PROJECT_DIR` (not a bare relative path): Claude Code does NOT
// guarantee the hook's cwd is the project root, so a relative command can
// silently fail to resolve → the gate fails OPEN again. The documented
// project-root placeholder is cwd-independent AND git-safe (no absolute machine
// path baked into a committed settings.json). checkHook expands it against root.
export const DEFAULT_HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/node_modules/@dusk/pre-tool-use/dist/cli.js"';

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

  const result = mergeHook(existing, options.hookCommand ?? DEFAULT_HOOK_COMMAND, options.conflictResolver ?? alwaysAppend);
  if (result.action === "aborted") return { action: "aborted", settingsPath };

  if (result.backup) writeFileSync(`${settingsPath}.bak`, `${JSON.stringify(result.backup, null, 2)}\n`, "utf8");
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(result.settings, null, 2)}\n`, "utf8");
  return { action: result.action, settingsPath };
}
