import { existsSync, readFileSync } from "node:fs";

import { runChecks } from "./checks.js";
import { loadProject } from "./loadProject.js";
import type { HookInput, HookOutput } from "./rejections.js";

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
