import { runGate } from "./runGate.js";
import type { HookOutput } from "./rejections.js";

/**
 * The PreToolUse hook binary. Reads a HookInput as JSON on stdin and writes the
 * result to stdout; exits 0 in all cases.
 *
 * CRITICAL (the real enforcement boundary — verified empirically against the
 * Claude Code CLI): a PreToolUse hook only BLOCKS the agent's write when the
 * process EXITS 2 with the reason on STDERR **and STDOUT is empty**. If the hook
 * writes a JSON body to stdout, Claude Code routes through its stdout-JSON
 * decision path instead — where the legacy `{ decision: "block" }` and even
 * `hookSpecificOutput.permissionDecision: "deny"` are NOT honored (and
 * `acceptEdits` overrides the JSON deny) — and the exit-2 block is disregarded.
 * So the gate was advisory-only (fail-OPEN) in the real harness until this fix.
 *
 * Stream contract (keeps both consumers working):
 *  - APPROVE → structured JSON on STDOUT, exit 0 (Claude Code allows on exit 0;
 *    `invokeHook`/tests read stdout — unchanged).
 *  - BLOCK   → structured JSON on STDERR, STDOUT empty, exit 2 (Claude Code
 *    blocks and shows the stderr reason to the agent; `invokeHook` reads the
 *    JSON from stderr). Internal errors fail SAFE the same way.
 */
function toClaudeEnvelope(output: HookOutput): HookOutput & { hookSpecificOutput: Record<string, unknown> } {
  if (output.decision === "block") {
    const r = output.structured_rejection;
    return {
      ...output,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `${output.reason} [${r.kind} at ${r.file}:${r.line}]`,
      },
    };
  }
  return { ...output, hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
}

// `--json`: machine-readable mode for programmatic/test callers — always print
// the structured HookOutput to stdout, exit 0/2 by decision. The production
// Claude Code hook NEVER passes this flag (dusk init wires `node <path>`), so
// the enforcement contract below is what runs in the real harness.
const JSON_MODE = process.argv.includes("--json");

function emit(output: HookOutput): never {
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(toClaudeEnvelope(output)));
    process.exit(output.decision === "block" ? 2 : 0);
  }
  if (output.decision === "block") {
    const r = output.structured_rejection;
    // PLAIN-TEXT reason on stderr + exit 2 + EMPTY stdout. Verified empirically:
    // any JSON (`permissionDecision`) routes Claude Code through its JSON-decision
    // path, which `--permission-mode acceptEdits` OVERRIDES; the plain-text +
    // exit-2 path is honored under EVERY permission mode. So the hook streams
    // carry no JSON on block (programmatic callers use `runGate` or `--json`).
    process.stderr.write(`Dusk gate blocked: ${output.reason} [${r.kind} at ${r.file}:${r.line}]\n`);
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(toClaudeEnvelope(output)));
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
