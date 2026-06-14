import { existsSync, readFileSync } from "node:fs";

import { runChecks } from "./checks.js";
import { loadProject } from "./loadProject.js";
import type { HookInput, HookOutput, RawHookInput } from "./rejections.js";

const EMPTY_ARGS: HookInput["args"] = { file_path: "" };

/**
 * Adapt Claude Code's real PreToolUse payload (`tool_name` / `tool_input`) to the
 * internal HookInput shape (`tool` / `args`), tolerating the legacy `tool`/`args`
 * aliases. A missing `tool_input` yields an empty file_path so the gate APPROVES
 * (it must never fail-safe block a payload it simply can't read a path from — that
 * is what turned this mismatch into an all-writes-blocked outage). Keeps runGate
 * pure: it only ever receives a normalized HookInput.
 */
export function normalizeHookInput(raw: RawHookInput): HookInput {
  return {
    tool: (raw.tool ?? raw.tool_name ?? "Write") as HookInput["tool"],
    args: raw.args ?? raw.tool_input ?? EMPTY_ARGS,
    ...(raw.session_id !== undefined ? { session_id: raw.session_id } : {}),
    ...(raw.transcript_path !== undefined ? { transcript_path: raw.transcript_path } : {}),
  };
}

function resolveContent(input: HookInput): string {
  if (input.args.content !== undefined) return input.args.content;
  if (input.args.edits && existsSync(input.args.file_path)) {
    let text = readFileSync(input.args.file_path, "utf8");
    for (const edit of input.args.edits) {
      text = edit.replace_all ? text.split(edit.old_string).join(edit.new_string) : text.replace(edit.old_string, edit.new_string);
    }
    return text;
  }
  return (input.args.edits ?? []).map((edit) => edit.new_string).join("\n");
}

const GATED_FILE = /\.(ts|tsx)$/;

/** Run the 10 mechanical checks against the would-be content. Pure; safe to call in-process or from the CLI. */
export function runGate(input: HookInput): HookOutput {
  const file = input.args.file_path;
  if (!GATED_FILE.test(file) && !file.endsWith(".intent")) return { decision: "approve" };
  const project = loadProject(file);
  if (!project) return { decision: "approve" }; // not a Dusk project — do not gate
  const content = resolveContent(input);
  const { rejections, warnings } = runChecks(content, file, project);
  if (rejections.length > 0) {
    return {
      decision: "block",
      reason: rejections[0].message,
      structured_rejection: rejections[0],
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
  return warnings.length > 0 ? { decision: "approve", warnings } : { decision: "approve" };
}
