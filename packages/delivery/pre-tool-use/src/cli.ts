import { runGate } from "./runGate.js";
import { normalizeHookInput, type HookOutput } from "./rejections.js";

/**
 * The PreToolUse hook binary. Reads the PreToolUse payload as JSON on stdin and
 * enforces the mechanical gate. Two payload shapes are accepted (see
 * `normalizeHookInput`): Claude Code's wire format `{ hook_event_name,
 * tool_name, tool_input }` AND the internal `{ tool, args }` shape used by
 * programmatic/test callers.
 *
 * CRITICAL (the real enforcement boundary — verified empirically against the
 * Claude Code CLI): a PreToolUse hook only BLOCKS the agent's write when the
 * process EXITS 2 with the reason on STDERR **and STDOUT is empty**. If the hook
 * writes a JSON body to stdout, Claude Code routes through its stdout-JSON
 * decision path instead — where the legacy `{ decision: "block" }` and even
 * `hookSpecificOutput.permissionDecision: "deny"` are NOT honored (and
 * `acceptEdits` overrides the JSON deny) — and the exit-2 block is disregarded.
 * So the gate was advisory-only (fail-OPEN) in the real harness before the
 * stream-contract fix, then fail-CLOSED-on-everything before the payload adapter.
 *
 * Stream contract (one honest shape per consumer — NO permissionDecision
 * envelope; Claude Code allows on exit 0 and blocks on exit 2 regardless of
 * stdout, and that JSON envelope was never honored):
 *  - production (no `--json`):
 *      APPROVE → empty stdout, exit 0.
 *      BLOCK   → plain-text reason on STDERR, STDOUT empty, exit 2 (honored under
 *                EVERY permission mode incl. acceptEdits).
 *  - `--json` (programmatic/test callers — `checkHook`, `invokeHook`):
 *      the raw `HookOutput` on STDOUT, exit 0/2 by decision.
 *  Internal errors / malformed payloads fail SAFE: block, exit 2.
 */

// `--json`: machine-readable mode for programmatic/test callers — always print
// the structured HookOutput to stdout, exit 0/2 by decision. The production
// Claude Code hook NEVER passes this flag (dusk init wires `node <path>`), so
// the enforcement contract below is what runs in the real harness.
const JSON_MODE = process.argv.includes("--json");

function emit(output: HookOutput): never {
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(output));
    process.exit(output.decision === "block" ? 2 : 0);
  }
  if (output.decision === "block") {
    const r = output.structured_rejection;
    // PLAIN-TEXT reason on stderr + exit 2 + EMPTY stdout. Verified empirically:
    // any JSON on stdout routes Claude Code through its JSON-decision path, which
    // `--permission-mode acceptEdits` OVERRIDES; the plain-text + exit-2 path is
    // honored under EVERY permission mode.
    process.stderr.write(`Dusk gate blocked: ${output.reason} [${r.kind} at ${r.file}:${r.line}]\n`);
    process.exit(2);
  }
  // APPROVE: the allow IS the exit code — nothing on stdout.
  process.exit(0);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  try {
    emit(runGate(normalizeHookInput(JSON.parse(raw))));
  } catch (error) {
    emit({
      decision: "block",
      reason: "hook internal error",
      structured_rejection: { kind: "hook_internal_error", file: "", line: 0, message: String((error as Error)?.message ?? error) },
    });
  }
});
