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
