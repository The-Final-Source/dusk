import { execFileSync } from "node:child_process";

/**
 * Real Vitest subprocess invocation (RFC §3.4, §6.6; design D8, Q1; 9.2). Runs
 * `pnpm vitest run <scoped-files> --reporter=json` from the WORKSPACE ROOT (Q1:
 * the workspace config is the source of truth) and parses the JSON reporter into
 * per-test results. The runner is injectable so the parser can be exercised
 * offline with the scripted reporter stub.
 */

export type TestResult = { file: string; title: string; status: "passed" | "failed"; duration: number };

export type VitestRunner = (files: string[], cwd: string) => string;

/** Build the exact Vitest argv (the assertion target for "excluded from invocation"). */
export const buildVitestArgv = (files: string[]): string[] => ["vitest", "run", ...files, "--reporter=json"];

const defaultRunner: VitestRunner = (files, cwd) =>
  execFileSync("pnpm", buildVitestArgv(files), { cwd, encoding: "utf8" });

/** Parse the `--reporter=json` payload into flat per-test results. */
export function parseVitestJson(stdout: string): TestResult[] {
  const json = JSON.parse(stdout) as {
    testResults?: Array<{ name: string; assertionResults: Array<{ title: string; status: string; duration?: number }> }>;
  };
  const out: TestResult[] = [];
  for (const file of json.testResults ?? []) {
    for (const a of file.assertionResults) {
      out.push({ file: file.name, title: a.title, status: a.status === "passed" ? "passed" : "failed", duration: a.duration ?? 0 });
    }
  }
  return out;
}

export type RunVitestInput = { files: string[]; cwd: string; runner?: VitestRunner };

/** Invoke Vitest (or the injected runner) over the scoped files and parse results. */
export function runVitest(input: RunVitestInput): { invokedFiles: string[]; results: TestResult[] } {
  if (input.files.length === 0) return { invokedFiles: [], results: [] };
  const runner = input.runner ?? defaultRunner;
  const stdout = runner(input.files, input.cwd);
  return { invokedFiles: input.files, results: parseVitestJson(stdout) };
}
