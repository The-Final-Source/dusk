/**
 * Scripted Vitest JSON-reporter stub (task 1.3d) — builds output structurally
 * identical to `vitest run --reporter=json` so the Test Runner's parser can be
 * exercised offline (the smoke test still uses the REAL Vitest subprocess). Only
 * the fields the parser reads are modeled.
 */

export type VitestAssertionStatus = "passed" | "failed";

export type VitestSpec = {
  /** Absolute test-file path. */
  file: string;
  /** The `test(...)` title. */
  title: string;
  status: VitestAssertionStatus;
  /** Per-test duration in ms (defaults to 1). */
  duration?: number;
  /** Defaults to `title` when omitted. */
  fullName?: string;
  ancestorTitles?: string[];
};

export type VitestJsonReport = {
  numTotalTestSuites: number;
  numPassedTestSuites: number;
  numFailedTestSuites: number;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: Array<{
    name: string;
    status: VitestAssertionStatus;
    assertionResults: Array<{
      ancestorTitles: string[];
      fullName: string;
      title: string;
      status: VitestAssertionStatus;
      duration: number;
    }>;
  }>;
};

/** Build a Vitest `--reporter=json` payload object from a flat list of specs. */
export function makeVitestJsonReport(specs: VitestSpec[]): VitestJsonReport {
  const byFile = new Map<string, VitestSpec[]>();
  for (const spec of specs) {
    const list = byFile.get(spec.file) ?? [];
    list.push(spec);
    byFile.set(spec.file, list);
  }

  const testResults = [...byFile.entries()].map(([name, fileSpecs]) => {
    const assertionResults = fileSpecs.map((s) => ({
      ancestorTitles: s.ancestorTitles ?? [],
      fullName: s.fullName ?? s.title,
      title: s.title,
      status: s.status,
      duration: s.duration ?? 1,
    }));
    const fileFailed = assertionResults.some((a) => a.status === "failed");
    return { name, status: (fileFailed ? "failed" : "passed") as VitestAssertionStatus, assertionResults };
  });

  const allAssertions = testResults.flatMap((r) => r.assertionResults);
  const passed = allAssertions.filter((a) => a.status === "passed").length;
  const failed = allAssertions.filter((a) => a.status === "failed").length;

  return {
    numTotalTestSuites: testResults.length,
    numPassedTestSuites: testResults.filter((r) => r.status === "passed").length,
    numFailedTestSuites: testResults.filter((r) => r.status === "failed").length,
    numTotalTests: allAssertions.length,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: 0,
    testResults,
  };
}

/** Build the JSON string (what the subprocess would emit on stdout). */
export const makeVitestJsonReportString = (specs: VitestSpec[]): string => JSON.stringify(makeVitestJsonReport(specs));

/**
 * Scripted PROJECT-SIDE ADAPTER capture (RFC App. D.34, decision ①) — emits
 * Dusk's OWN result schema (`DuskTestRunResult`) inside a `TestCommandCapture`,
 * the shape the Test Runner core now reads (it no longer parses a tool's
 * vocabulary). Mirrors what a real project-side vitest reporter / pytest plugin
 * would write. Use this for an injected `vitestRunner` double that should yield a
 * CONTENT verdict; use the raw `makeVitestJsonReportString` (NOT Dusk's schema) to
 * exercise the `no_verdict` (schema-absent) path. The return is structurally a
 * `@dusk/runtime-test-runner` `TestCommandCapture` (no type import — structural).
 */
export function makeDuskTestCapture(
  specs: VitestSpec[],
  opts: { completed?: boolean; timedOut?: boolean } = {},
): { stdout: string; exitCode: number | null; timedOut: boolean } {
  const cases = specs.map((s) => ({
    name: s.title,
    outcome: (s.status === "passed" ? "passed" : "failed") as "passed" | "failed" | "not_run",
    duration_ms: s.duration ?? 1,
  }));
  const passed = cases.filter((c) => c.outcome === "passed").length;
  const failed = cases.filter((c) => c.outcome === "failed").length;
  const result = { schema_version: 1 as const, passed, failed, not_run: 0, completed: opts.completed ?? true, cases };
  return { stdout: JSON.stringify(result), exitCode: failed > 0 ? 1 : 0, timedOut: opts.timedOut ?? false };
}
