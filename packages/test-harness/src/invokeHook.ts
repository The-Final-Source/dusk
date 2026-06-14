import { spawnSync } from "node:child_process";

/**
 * Drive the REAL PreToolUse hook process: spawn `node <binPath>`, pipe a HookInput
 * as JSON on stdin, and parse the structured HookOutput. This exercises the
 * actual out-of-process contract, not an in-proc shim.
 *
 * The hook puts the structured JSON on STDOUT for approve (exit 0) and on STDERR
 * for block (exit 2 — Claude Code only honors the block when stdout is empty),
 * so the result is parsed from stdout-or-stderr. `exitCode` IS the decision:
 * 0 = approve, 2 = block.
 */
export type HookResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: unknown; // parsed HookOutput, or undefined if neither stream held JSON
};

const tryParse = (text: string): unknown => {
  try {
    return JSON.parse(text.trim());
  } catch {
    return undefined;
  }
};

/**
 * @param opts.json — pass `--json` so the gate binary emits the structured
 *   HookOutput on stdout (machine-readable mode). Without it the binary runs the
 *   production Claude Code hook contract (plain-text stderr + exit 2 on block),
 *   so `output` is only populated for approve; use `exitCode` (0/2) for block.
 */
export function invokeHook(binPath: string, input: unknown, opts: { json?: boolean } = {}): HookResult {
  const result = spawnSync(process.execPath, [binPath, ...(opts.json ? ["--json"] : [])], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    output: tryParse(result.stdout) ?? tryParse(result.stderr),
  };
}
