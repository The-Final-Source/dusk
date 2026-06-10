import type { DerivedIndex } from "@dusk/core-index";
import { duskError, err, isDuskError, ok, type BoundSpawn, type RuntimeResult, type TestVerdict } from "@dusk/core-schema";

import { coveredTriplesFor, discoverTestClaims, testFilesFor, type TestClaim } from "./discovery.js";
import { assembleTestVerdict } from "./verdict.js";
import { runVitest, type VitestRunner } from "./vitest.js";

/**
 * Step-6 two-stage test satisfaction (RFC §3.4; design D8; 9.1/9.2). Stage 1: a
 * Verifier pre-pass evaluates each `@intent-test` body. Tests that fail the
 * pre-pass are EXCLUDED from the scoped file list passed to Vitest — they never
 * run, and the bead re-enters Step 4 to fix them. Stage 2: the surviving files
 * run under real Vitest and roll up to a per-test-intent `TestVerdict`.
 */

export type TestRunnerDeps = {
  spawn: BoundSpawn;
  index: DerivedIndex;
  beadId: string;
  sessionId: string;
  testIntentPath: string;
  /** Build the Verifier pre-pass input for a test claim (the test body under review). */
  prepassInput: (claim: TestClaim) => string;
  /** Workspace root for the Vitest subprocess (Q1). */
  cwd: string;
  vitestRunner?: VitestRunner;
};

export type RejectedTest = { test_intent_path: string; triple_id: string; rationale: string };

export type TestRunnerOutcome =
  | { kind: "verdict"; verdict: TestVerdict; invokedFiles: string[] }
  | { kind: "reenter_step4"; rejected: RejectedTest[]; invokedFiles: string[] };

export async function runTestRunner(deps: TestRunnerDeps): Promise<RuntimeResult<TestRunnerOutcome>> {
  const claims = discoverTestClaims(deps.index, deps.testIntentPath);

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
    if (!verdict || isDuskError(verdict)) {
      return err(duskError("verifier_model_call_failed", "test pre-pass Verifier returned no verdict", { recoverable: false, bead_id: deps.beadId, step: 6 }));
    }
    const failedTriple = verdict.per_triple.find((t) => t.focal_verdict === "fail");
    const failed = verdict.decision === "reject" || failedTriple !== undefined;
    if (failed) {
      rejectedFiles.add(claim.file);
      const rationale = failedTriple?.rationale ?? verdict.aggregate_rationale;
      for (const triple_id of claim.coveredTriples) rejected.push({ test_intent_path: claim.testIntentPath, triple_id, rationale });
    }
  }

  // Stage 2 — only Verifier-validated files reach Vitest (rejected files excluded).
  const allFiles = testFilesFor(deps.index, deps.testIntentPath);
  const includedFiles = allFiles.filter((f) => !rejectedFiles.has(f));

  if (rejected.length > 0) {
    // A rejected test re-enters Step 4; its file never reaches Vitest.
    return ok({ kind: "reenter_step4", rejected, invokedFiles: includedFiles });
  }

  const { invokedFiles, results } = runVitest({ files: includedFiles, cwd: deps.cwd, runner: deps.vitestRunner });
  const verdict = assembleTestVerdict({
    testIntentPath: deps.testIntentPath,
    coveredTriples: coveredTriplesFor(deps.index, deps.testIntentPath),
    results,
  });
  return ok({ kind: "verdict", verdict, invokedFiles });
}
