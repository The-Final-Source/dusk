import { spawnSync } from "node:child_process";

/**
 * Project test-command invocation (RFC §3.4, §6.6, App. D.34; design D6). The
 * core captures ONLY `{stdout, exitCode, timedOut}` — it never parses a tool's
 * vocabulary (no reading vitest's `success`/`numFailedTests`, no inferring a
 * verdict from an exit code). `spawnSync` (not `execFileSync`) is used so a
 * non-zero exit is DATA, never a throw (gap #3 — the former `execFileSync` threw
 * and crashed the unguarded orchestrator try/finally). Interpretation of the
 * capture is the Dusk-result-schema floor (`readDuskTestResult`, in `core-schema`)
 * — which reads ONLY Dusk's OWN result schema, emitted by a project-side
 * adapter/reporter (a Phase-VI/project task). The runner is injectable so tests
 * exercise the path offline.
 */

/** Raw capture from the project's test command — the ONLY thing the core reads from the tool (R5). */
export type TestCommandCapture = { stdout: string; exitCode: number | null; timedOut: boolean };

/** The injected test-command runner. Returns a capture; NEVER throws (a non-zero exit is data). */
export type VitestRunner = (files: string[], cwd: string) => TestCommandCapture;

/**
 * The default test-command argv. The argv is config-/project-supplied and OPAQUE
 * to the core (R4) — the project-side adapter configures the reporter that emits
 * Dusk's own result schema; this default is only a placeholder for offline runs.
 */
export const buildVitestArgv = (files: string[]): string[] => ["vitest", "run", ...files, "--reporter=json"];

const defaultRunner: VitestRunner = (files, cwd) => {
  const r = spawnSync("pnpm", buildVitestArgv(files), { cwd, encoding: "utf8" });
  const timedOut =
    (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || r.signal === "SIGKILL" || r.signal === "SIGTERM";
  return { stdout: r.stdout ?? "", exitCode: r.status, timedOut };
};

export type RunVitestInput = { files: string[]; cwd: string; runner?: VitestRunner };

/** Invoke the test command (or injected runner) over the scoped files and capture raw output — never throws. */
export function runVitest(input: RunVitestInput): { invokedFiles: string[]; capture: TestCommandCapture } {
  if (input.files.length === 0) return { invokedFiles: [], capture: { stdout: "", exitCode: null, timedOut: false } };
  const runner = input.runner ?? defaultRunner;
  return { invokedFiles: input.files, capture: runner(input.files, input.cwd) };
}
