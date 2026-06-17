import type { DerivedIndex } from "@dusk/core-index";
import { isDuskError, ok, readDuskTestResult, type BoundSpawn, type NoVerdictReason, type RuntimeResult, type TestVerdict } from "@dusk/core-schema";

import { coveredTriplesFor, discoverTestClaims, testFilesFor, type TestClaim } from "./discovery.js";
import { assembleTestVerdict } from "./verdict.js";
import { runVitest, type VitestRunner } from "./vitest.js";

/**
 * Step-6 two-stage test satisfaction (RFC §3.4; design D8; App. D.34). Stage 1: a
 * Verifier pre-pass evaluates each `@intent-test` body. Tests that fail the
 * pre-pass are EXCLUDED from the scoped file list passed to the runner — they
 * never run, and the bead re-enters Step 4 to fix them. Stage 2: the surviving
 * files run under the project test command, whose output is read ONLY through
 * Dusk's own result schema (the mechanical floor) and routed to exactly one of:
 *   - content `pass`  → a `verdict` outcome (commit proceeds)
 *   - content `fail`  → a `reenter_step4` outcome (re-draft + BLOCK commit; gap #1,
 *                       routed through the orchestrator's EXISTING livelock block)
 *   - `no_verdict`    → the infrastructure recovery axis (never a content fail,
 *                       never a silent green, never a crash; gaps #3/#8/#9)
 */

/** The agentic-bridge interpretation of schema-absent raw test output (RFC App.
 * D.34, decision ①). It may push ONLY toward `fail` or `no_verdict` — NEVER
 * `pass` (a content pass requires Dusk's OWN result schema; this asymmetry
 * guarantees no silent green). The implementor MUST guard its own parse → a
 * degraded interpretation resolves to `no_verdict`. */
export type TestOutputInterpretation =
  | { kind: "fail"; rationale: string }
  | { kind: "no_verdict"; reason: NoVerdictReason };
export type TestOutputInterpreter = (input: { stdout: string; exitCode: number | null; invokedFiles: string[] }) => Promise<TestOutputInterpretation>;

export type TestRunnerDeps = {
  spawn: BoundSpawn;
  index: DerivedIndex;
  beadId: string;
  sessionId: string;
  testIntentPath: string;
  /** Build the Verifier pre-pass input for a test claim (the test body under review). */
  prepassInput: (claim: TestClaim) => string;
  /** Workspace root for the test subprocess (Q1). */
  cwd: string;
  vitestRunner?: VitestRunner;
  /** Agentic bridge for raw output that did NOT yield Dusk's own result schema
   * (decision ①). When absent, schema-absent output resolves to `no_verdict`. */
  interpretTestOutput?: TestOutputInterpreter;
};

export type RejectedTest = { test_intent_path: string; triple_id: string; rationale: string };

export type TestRunnerOutcome =
  | { kind: "verdict"; verdict: TestVerdict; invokedFiles: string[] }
  | { kind: "reenter_step4"; rejected: RejectedTest[]; invokedFiles: string[] }
  // App. D.34: the Stage-2 boundary did not yield Dusk's own result schema
  // (reporter absent/crashed, OOM, our timeout, garbage) — the infrastructure
  // recovery axis. NEVER a content fail, a silent green, or a crash.
  | { kind: "no_verdict"; reason: NoVerdictReason; invokedFiles: string[] };

/** RFC App. D.32 marker hint — the explicit signal a routed test intent has no locatable body. */
export const NO_TEST_MARKER_KIND = "test_intent_no_test_marker";

export async function runTestRunner(deps: TestRunnerDeps): Promise<RuntimeResult<TestRunnerOutcome>> {
  const claims = discoverTestClaims(deps.index, deps.testIntentPath);

  // Fail loud + legible on a missing test body (RFC App. D.32, design D3). UNCHANGED
  // by D.34: this is a content-routing guard (re-enter Step 4 to add the marker),
  // not an infrastructure boundary.
  if (claims.length === 0) {
    const intent = deps.index.intents.get(deps.testIntentPath);
    const tripleIds = intent
      ? (intent.compose === "implies" ? (intent.consequent ?? []) : (intent.triples ?? [])).map((t) => t.id)
      : [];
    const rationale = `${NO_TEST_MARKER_KIND}: '${deps.testIntentPath}' has no @intent-test/@intent-test-file marker locating its test body — decorate the test file with @intent-test-file ${deps.testIntentPath} (file scope) or @intent-test (declaration scope), never @intent`;
    const rejected = (tripleIds.length > 0 ? tripleIds : [deps.testIntentPath]).map((triple_id) => ({
      test_intent_path: deps.testIntentPath,
      triple_id,
      rationale,
    }));
    return ok({ kind: "reenter_step4", rejected, invokedFiles: [] });
  }

  // Stage 1 — Verifier pre-pass on each test body; collect rejected claims.
  const rejectedFiles = new Set<string>();
  const rejected: RejectedTest[] = [];
  for (const claim of claims) {
    const spawn = await deps.spawn({
      role: "verifier",
      beadId: deps.beadId,
      sessionId: deps.sessionId,
      input: deps.prepassInput(claim),
      invocationSite: "test-execution",
      intentPath: claim.testIntentPath,
    });
    if (!spawn.success) return spawn;
    const verdict = spawn.value.verdict;
    // App. D.34 (gap #9): an empty/degraded Stage-1 verdict is INFRASTRUCTURE, not
    // a content reject. Route it to the `no_verdict` axis — NEVER the former
    // terminal `recoverable:false` downgrade that aborted the run.
    if (!verdict || isDuskError(verdict)) {
      return ok({ kind: "no_verdict", reason: "empty", invokedFiles: [] });
    }
    const failedTriple = verdict.per_triple.find((t) => t.focal_verdict === "fail");
    const failed = verdict.decision === "reject" || failedTriple !== undefined;
    if (failed) {
      rejectedFiles.add(claim.file);
      const rationale = failedTriple?.rationale ?? verdict.aggregate_rationale;
      for (const triple_id of claim.coveredTriples) rejected.push({ test_intent_path: claim.testIntentPath, triple_id, rationale });
    }
  }

  // Stage 2 — only Verifier-validated files reach the runner (rejected files excluded).
  const allFiles = testFilesFor(deps.index, deps.testIntentPath);
  const includedFiles = allFiles.filter((f) => !rejectedFiles.has(f));

  if (rejected.length > 0) {
    // A rejected test re-enters Step 4; its file never reaches the runner.
    return ok({ kind: "reenter_step4", rejected, invokedFiles: includedFiles });
  }

  const { invokedFiles, capture } = runVitest({ files: includedFiles, cwd: deps.cwd, runner: deps.vitestRunner });
  // The mechanical floor (R4/R5/R11): read ONLY Dusk's own result schema. Never
  // infer a verdict from a tool's vocabulary, an exit code, or the absence of a
  // failure.
  const read = readDuskTestResult(capture.stdout, { timedOut: capture.timedOut });
  const coveredTriples = coveredTriplesFor(deps.index, deps.testIntentPath);

  if (read.outcome === "no_verdict") {
    // The Dusk result schema is absent (no project-side adapter, reporter crash,
    // OOM, garbage). If OUR OWN timeout fired it is definitively infrastructure.
    // Otherwise the AGENTIC BRIDGE interprets the raw output (decision ①): it may
    // push ONLY toward `fail` (a genuine assertion failure it read) or
    // `no_verdict` — NEVER `pass` (a pass requires Dusk's own schema; the
    // asymmetry guaranteeing no silent green). A degraded interpretation (the
    // implementor's guarded parse) is `no_verdict`.
    if (capture.timedOut || !deps.interpretTestOutput) {
      return ok({ kind: "no_verdict", reason: read.boundary.reason, invokedFiles });
    }
    const interp = await deps.interpretTestOutput({ stdout: capture.stdout, exitCode: capture.exitCode, invokedFiles });
    if (interp.kind === "fail") {
      const rationale = `Stage-2 (agent-read raw output): ${interp.rationale}`;
      const rejected = (coveredTriples.length > 0 ? coveredTriples : [deps.testIntentPath]).map((triple_id) => ({
        test_intent_path: deps.testIntentPath,
        triple_id,
        rationale,
      }));
      return ok({ kind: "reenter_step4", rejected, invokedFiles });
    }
    return ok({ kind: "no_verdict", reason: interp.reason, invokedFiles });
  }
  if (read.outcome === "fail") {
    // gap #1 / R7: a content Stage-2 `fail` re-enters Step 4 (re-draft + BLOCK
    // commit), routed through the orchestrator's EXISTING livelock-observation
    // block via the `reenter_step4` outcome — zero new orchestrator branches.
    const rationale = `Stage-2: ${read.result.failed} failing test(s) for this triple`;
    const failedRejected = (coveredTriples.length > 0 ? coveredTriples : [deps.testIntentPath]).map((triple_id) => ({
      test_intent_path: deps.testIntentPath,
      triple_id,
      rationale,
    }));
    return ok({ kind: "reenter_step4", rejected: failedRejected, invokedFiles });
  }

  const verdict = assembleTestVerdict({
    testIntentPath: deps.testIntentPath,
    coveredTriples,
    result: read.result,
    outcome: "pass",
  });
  return ok({ kind: "verdict", verdict, invokedFiles });
}
