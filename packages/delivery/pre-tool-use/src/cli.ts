import { runGate } from "./runGate.js";
import type { HookOutput } from "./rejections.js";

/**
 * The PreToolUse hook binary. Reads a HookInput as JSON on stdin, writes a HookOutput as
 * JSON on stdout, and exits 0 in all cases. Any failure fails SAFE as a block.
 */
function emit(output: HookOutput): never {
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw);
    emit(runGate(input));
  } catch (error) {
    emit({
      decision: "block",
      reason: "hook internal error",
      structured_rejection: { kind: "hook_internal_error", file: "", line: 0, message: String((error as Error)?.message ?? error) },
    });
  }
});
