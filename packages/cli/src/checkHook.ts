import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, join } from "node:path";

import { DUSK_MARKER } from "./settingsMerge.js";
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

  const command = String(entry.command ?? "");
  const binPath = command.replace(/^node\s+/, "").trim();
  const resolved = isAbsolute(binPath) ? binPath : join(root, binPath);
  if (!existsSync(resolved)) return configIssue(`hook command path unresolvable: ${resolved}`);

  const synthetic = { tool: "Write", args: { file_path: join(root, "README.md"), content: "# round-trip" } };
  const result = spawnSync(process.execPath, [resolved], { input: JSON.stringify(synthetic), encoding: "utf8" });
  try {
    const output = JSON.parse(result.stdout.trim()) as { decision?: string };
    if (output?.decision === "approve" || output?.decision === "block") {
      return { exitCode: 0, message: "hook installed and round-trips" };
    }
  } catch {
    // fall through to the round-trip failure (never auto-fixed, even with --repair)
  }
  return { exitCode: 3, message: "hook round-trip failed (handler malfunctioning)" };
}
