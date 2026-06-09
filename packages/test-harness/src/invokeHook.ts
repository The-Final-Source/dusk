import { spawnSync } from "node:child_process";

/**
 * Drive the REAL PreToolUse hook process: spawn `node <binPath>`, pipe a HookInput
 * as JSON on stdin, and parse the HookOutput JSON from stdout. This exercises the
 * actual out-of-process contract, not an in-proc shim.
 */
export type HookResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: unknown; // parsed HookOutput, or undefined if stdout was not JSON
};

export function invokeHook(binPath: string, input: unknown): HookResult {
  const result = spawnSync(process.execPath, [binPath], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  let output: unknown;
  try {
    output = JSON.parse(result.stdout.trim());
  } catch {
    output = undefined;
  }
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    output,
  };
}
