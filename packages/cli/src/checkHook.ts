import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, join } from "node:path";

import { DUSK_MANAGED, DUSK_MARKER, hookEntryCommand, isClaudeCodeFiringShape } from "./settingsMerge.js";
import { initProject } from "./init.js";

export type CheckHookOptions = { repair?: boolean; hookCommand?: string };
export type CheckHookResult = { exitCode: 0 | 2 | 3; message: string };

/** Verify the gate is installed and round-trips. Exit 0 (pass) / 2 (config issue) / 3 (round-trip failure). */
export function checkHook(root: string, options: CheckHookOptions = {}): CheckHookResult {
  const settingsPath = join(root, ".claude/settings.json");
  const repairAndRecheck = (): CheckHookResult => {
    initProject(root, { hookCommand: options.hookCommand });
    return checkHook(root, { ...options, repair: false });
  };
  const configIssue = (message: string): CheckHookResult =>
    options.repair ? repairAndRecheck() : { exitCode: 2, message };

  if (!existsSync(settingsPath)) return configIssue("settings.json not found");

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return configIssue("settings.json is not valid JSON");
  }

  const list = ((settings.hooks as Record<string, unknown>)?.PreToolUse ?? []) as Array<Record<string, unknown>>;
  const entry = list.find((e) => e?._dusk_marker === DUSK_MARKER);
  if (!entry) return configIssue("Dusk hook marker not found");

  // Load-bearing SHAPE gate: a marker-bearing entry in the legacy/non-firing
  // shape (or stamped at an older version) is NOT a working gate — Claude Code
  // silently never fires it. Reject it (and auto-repair with --repair) instead
  // of green-lighting a hook that fails open. This is what the version stamp is
  // FOR — it was dead before this check.
  if ((entry as Record<string, unknown>)._dusk_managed !== DUSK_MANAGED || !isClaudeCodeFiringShape(entry as Record<string, unknown>)) {
    return configIssue("hook present but in an unrecognized/legacy shape — Claude Code will not fire it; run dusk init --repair");
  }

  // The hook command lives at entry.hooks[].command (Claude Code shape); the
  // legacy flat entry.command is read as a fallback during migration.
  const command = hookEntryCommand(entry as Record<string, unknown>);
  // Expand the `$CLAUDE_PROJECT_DIR` placeholder against `root` (Claude Code's
  // project-root variable) so checkHook resolves the SAME binary the live hook
  // runs, not a path relative to checkHook's own cwd.
  const expanded = command.replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, root);
  const binPath = expanded.replace(/^node\s+/, "").replace(/^["']|["']$/g, "").trim();
  const resolved = isAbsolute(binPath) ? binPath : join(root, binPath);
  if (!existsSync(resolved)) return configIssue(`hook command path unresolvable: ${resolved}`);

  // Round-trip the binary in --json mode using the REAL Claude Code wire payload
  // (`{ hook_event_name, tool_name, tool_input }`) — NOT the internal shape — so
  // a payload-adapter regression turns this diagnostic RED instead of hiding it.
  // README.md is non-gated, so a working handler must round-trip to "approve".
  const synthetic = { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(root, "README.md"), content: "# round-trip" } };
  const result = spawnSync(process.execPath, [resolved, "--json"], { input: JSON.stringify(synthetic), encoding: "utf8" });
  try {
    const output = JSON.parse(result.stdout.trim()) as { decision?: string };
    // MUST be "approve": README.md is non-gated, so a healthy handler approves
    // it. A "block" here means the handler malfunctioned (e.g. a payload-shape
    // crash → hook_internal_error) — that is the false-pass we refuse to mask.
    if (output?.decision === "approve") {
      return { exitCode: 0, message: "hook installed and round-trips" };
    }
  } catch {
    // fall through to the round-trip failure (never auto-fixed, even with --repair)
  }
  return { exitCode: 3, message: "hook round-trip failed (handler malfunctioning)" };
}
