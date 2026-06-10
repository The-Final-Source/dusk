import { existsSync, readFileSync } from "node:fs";

import type { DerivedIndex } from "@dusk/core-index";
import {
  duskError,
  err,
  ok,
  type BoundSpawn,
  type CommitTrailers,
  type DuskConfig,
  type RuntimeResult,
  type SpawnOutcome,
} from "@dusk/core-schema";
import { testPyramidSuffixes } from "@dusk/core-schema";
import { decompose } from "@dusk/runtime-decomposer";
import { loadForResume, deleteCheckpoint, type Clock as CheckpointClock } from "@dusk/runtime-implement-checkpoint";
import { commitBead } from "@dusk/runtime-commit";
import { runLongCycle, affectedUniverse, type ImportGraph } from "@dusk/runtime-long-cycle";
import { runMerge, topoOrder } from "@dusk/runtime-merge";
import { freezeResumePath, runRecoveryLadder } from "@dusk/runtime-recovery-ladder";
import { runShortCycle, type GateResult } from "@dusk/runtime-short-cycle";
import { runTestRunner, type VitestRunner } from "@dusk/runtime-test-runner";
import { createWorktreesForDag, planWorktrees, worktreePathFor } from "@dusk/runtime-worktree";

import { endActiveRun, setBeadStatus, startActiveRun, upsertBead, type BeadStatus } from "./activeRun.js";
import type { RuntimeEnv } from "./env.js";
import { getOrBuildSnapshot, type SessionSnapshot } from "./snapshot.js";
import { spawnSubAgent, type Clock, type TaskRunner, type TraceSink } from "./spawn.js";
import type { VerifierFactory } from "@dusk/core-schema";
import { assembleSummary, type CommitSummary, type ImplementSummary } from "./summary.js";

/**
 * The 9-step `dusk_implement` state machine (RFC §6.1–§6.9; 13.1 / 11.5). Wires
 * Decomposer → Worktrees → Short Cycle → Long Cycle → Test Execution → Commit →
 * Merge → Return Summary. The model/git/Vitest dependencies are injected so the
 * pipeline runs zero-model under the scripted-verdict double and against real
 * deps for the smoke matrix. Returns the Step-9 summary on success or a typed
 * `DuskError` on a pause / conflict / recovery-ladder / livelock outcome.
 */

export type RunImplementDeps = {
  rootDir: string;
  sessionId: string;
  /** Spawn primitives — bound internally with the run's index_snapshot_id. */
  env: RuntimeEnv;
  taskRunner: TaskRunner;
  verifierFactory: VerifierFactory;
  traceSink?: TraceSink;
  buildIndex: () => DerivedIndex;
  clock: Clock;
  config: DuskConfig;
  perEntryMax: number;
  lifetimeMax: number;
  verifierModel?: string;
  testRunnerModel?: string;
  importGraph?: ImportGraph;
  vitestRunner?: VitestRunner;
  baseRef?: string;
  rebuildIndex?: boolean;
  gate?: (engineer: SpawnOutcome) => GateResult;
  resolveCommit?: (repoDir: string, ref: string) => string;
};

export type RunImplementRequest = { request?: string; resumeToken?: string; scopeHint?: string[] };

const emptyGraph: ImportGraph = { imports: () => [], importedBy: () => [] };

function tripleIdsOf(index: DerivedIndex, intentPath: string): string[] {
  const intent = index.intents.get(intentPath);
  if (!intent) return [];
  return [...(intent.triples ?? []), ...(intent.consequent ?? [])].map((t) => t.id);
}

export async function runImplement(req: RunImplementRequest, deps: RunImplementDeps): Promise<RuntimeResult<ImplementSummary>> {
  const startedAt = deps.clock.now();

  // ---- Validate the entry contract: exactly one of request / resume_token. ----
  if (!req.request && !req.resumeToken) {
    return err(duskError("config_invalid", "dusk_implement requires exactly one of { request, resume_token }; neither was provided", { recoverable: true }));
  }
  if (req.request && req.resumeToken) {
    return err(duskError("config_invalid", "dusk_implement requires exactly one of { request, resume_token }; both were provided", { recoverable: true }));
  }

  let request = req.request;
  let scopeHint = req.scopeHint;
  if (req.resumeToken) {
    const loaded = loadForResume(deps.rootDir, req.resumeToken, deps.clock as CheckpointClock);
    if (!loaded.success) return loaded;
    request = loaded.value.original_request;
    scopeHint = loaded.value.scope_hint ?? scopeHint;
    // Single-use: consume the checkpoint as the pipeline transitions out of Step 1.
    deleteCheckpoint(deps.rootDir, req.resumeToken);
  }

  // ---- Session snapshot (Step 0). ----
  const snapshot: SessionSnapshot = getOrBuildSnapshot(
    deps.sessionId,
    { repoDir: deps.rootDir, baseRef: deps.baseRef, buildIndex: deps.buildIndex, resolveCommit: deps.resolveCommit },
    { rebuildIndex: deps.rebuildIndex },
  );
  const run = startActiveRun(deps.sessionId, snapshot);
  const nowIso = new Date(deps.clock.now()).toISOString();

  // Bind the spawn with the run's index_snapshot_id so every trace carries it.
  const spawn: BoundSpawn = (params) =>
    spawnSubAgent(params, {
      rootDir: deps.rootDir,
      env: deps.env,
      clock: deps.clock,
      taskRunner: deps.taskRunner,
      verifierFactory: deps.verifierFactory,
      ...(deps.traceSink ? { traceSink: deps.traceSink } : {}),
      indexSnapshotId: snapshot.id,
    });

  try {
    // ---- Steps 1-2: Decompose → bead DAG. ----
    const decomposed = decompose({
      index: snapshot.index,
      clock: deps.clock,
      rootDir: deps.rootDir,
      request: request!,
      scopeHint,
      suffixes: testPyramidSuffixes(deps.config),
    });
    if (!decomposed.success) return decomposed;
    const { dag, beadForIntent, warnings: decomposeWarnings } = decomposed.value;

    // ---- Step 3: Worktrees. ----
    const groups = planWorktrees(dag);
    const worktreeForBead = new Map<string, string>();
    for (const group of groups) for (const beadId of group.beads) worktreeForBead.set(beadId, worktreePathFor(deps.rootDir, group.worktreeBead));
    const created = createWorktreesForDag(deps.rootDir, dag, { baseRef: deps.baseRef });
    if (!created.success) return created;

    for (const node of dag.nodes) {
      upsertBead(run, { id: node.bead_id, status: "decomposing", current_step: "Step 3 — worktree", started_at: nowIso, branch: `dusk/${node.bead_id}` });
    }

    const commits: CommitSummary[] = [];
    const beadsSummary: ImplementSummary["beads_summary"] = [];
    const intentsTouched: string[] = [];
    const testIntentsExecuted: string[] = [];
    const lowConfidenceSupports: ImplementSummary["low_confidence_supports"] = [];
    const warnings = decomposeWarnings.map((w) => w.message);

    // ---- Steps 4-7 per bead (topological). ----
    for (const beadId of topoOrder(dag)) {
      const node = dag.nodes.find((n) => n.bead_id === beadId)!;
      const worktreePath = worktreeForBead.get(beadId)!;
      const primaryIntent = node.intent_paths[0];
      const suffixes = testPyramidSuffixes(deps.config);
      const testIntents = node.intent_paths.filter((p) => suffixes.includes(p.split("/").at(-1) ?? ""));
      intentsTouched.push(...node.intent_paths);

      const beadResult = await processBead({ beadId, worktreePath, primaryIntent, testIntents, node, snapshot, run, deps, spawn });
      if (!beadResult.success) return beadResult;

      commits.push({ bead_id: beadId, commit_sha: beadResult.value.commitSha, branch: `dusk/${beadId}` });
      beadsSummary.push({ bead_id: beadId, status: beadResult.value.status, exit_iter: beadResult.value.exitIter });
      testIntentsExecuted.push(...beadResult.value.testIntentsExecuted);
      lowConfidenceSupports.push(...beadResult.value.lowConfidenceSupports);
    }

    // ---- Step 8: Merge (topological rebase). ----
    const merged = runMerge({ repoDir: deps.rootDir, dag });
    if (!merged.success) return merged;

    // ---- Step 9: Return summary. ----
    return ok(
      assembleSummary({
        commits,
        beads: beadsSummary,
        intentsTouched,
        testIntentsExecuted,
        traceIds: [],
        totalDurationMs: Math.max(0, deps.clock.now() - startedAt),
        totalCostUsd: 0,
        warnings,
        lowConfidenceSupports,
      }),
    );
  } finally {
    endActiveRun();
  }
}

type ProcessBeadInput = {
  beadId: string;
  worktreePath: string;
  primaryIntent: string;
  testIntents: string[];
  node: { intent_paths: string[]; predicted_files: string[] };
  snapshot: SessionSnapshot;
  run: ReturnType<typeof startActiveRun>;
  deps: RunImplementDeps;
  spawn: BoundSpawn;
  /** Lifetime iterations already consumed (resume from a frozen bead). */
  lifetimeStart?: number;
};

type ProcessBeadOk = { commitSha: string; status: BeadStatus; exitIter: number; testIntentsExecuted: string[]; lowConfidenceSupports: ImplementSummary["low_confidence_supports"] };

async function processBead(input: ProcessBeadInput): Promise<RuntimeResult<ProcessBeadOk>> {
  const { deps, beadId, snapshot } = input;
  const triples = tripleIdsOf(snapshot.index, input.primaryIntent);
  const lowConfidenceSupports: ImplementSummary["low_confidence_supports"] = [];
  let lifetimeIter = input.lifetimeStart ?? 0;
  const diagnosisHistory: string[] = [];

  setBeadStatus(input.run, beadId, "short_cycle", "Step 4 — short cycle");

  for (;;) {
    const short = await runShortCycle({
      spawn: input.spawn,
      beadId,
      sessionId: deps.sessionId,
      rootDir: deps.rootDir,
      intentPath: input.primaryIntent,
      perEntryMax: deps.perEntryMax,
      lifetimeMax: deps.lifetimeMax,
      lifetimeStart: lifetimeIter,
      engineerInput: (fb) => `Implement ${input.primaryIntent}${fb ? ` — ${fb}` : ""}`,
      verifierInput: `Evaluate the focal claims of ${input.primaryIntent} [${triples.join(", ")}].`,
      gate: deps.gate,
    });
    if (!short.success) return short;

    if (short.value.kind === "per_entry_exhausted") {
      lifetimeIter = short.value.lifetimeIters;
      continue; // long-cycle bounce / re-entry
    }
    if (short.value.kind === "escalated_iter15") {
      return err(duskError("pipeline_iteration_cap_exceeded", `bead ${beadId} escalated at iter 15 for operator input`, { recoverable: true, bead_id: beadId, step: 4, details: { diagnosis: short.value.diagnosis } }));
    }
    if (short.value.kind === "budget_exhausted") {
      setBeadStatus(input.run, beadId, "paused_recovery_ladder", "Step 4 — recovery ladder");
      const trailers = baseTrailers(beadId, input.node.intent_paths, snapshot, deps);
      const ladder = runRecoveryLadder({
        rootDir: deps.rootDir,
        beadId,
        worktreePath: input.worktreePath,
        satisfiedIntents: [],
        deferredIntents: input.node.intent_paths,
        diagnosisHistory: short.value.diagnosisHistory.map((text, i) => ({ iter: i + 1, text })),
        lastVerdicts: [],
        beadMemory: "",
        trailers,
        subject: `wip: ${input.primaryIntent} (recovery)`,
        freezeResume: { intent_paths: input.node.intent_paths, lifetime_iter: short.value.lifetimeIters, branch: `dusk/${beadId}` },
      });
      if (!ladder.success) return ladder;
      if (ladder.value.level === "L1") {
        return ok({ commitSha: ladder.value.commit.commit_sha, status: "done", exitIter: lifetimeIter, testIntentsExecuted: [], lowConfidenceSupports });
      }
      return err(ladder.value.error); // L2 / L3 / L4 terminal
    }

    // converged
    lifetimeIter = short.value.lifetimeIters;
    lowConfidenceSupports.push(...short.value.lowConfidenceSupports);
    void diagnosisHistory;

    // ---- Step 5: Long cycle. ----
    setBeadStatus(input.run, beadId, "long_cycle", "Step 5 — long cycle");
    const universe = affectedUniverse(input.node.predicted_files, snapshot.index, deps.importGraph ?? emptyGraph);
    const long = await runLongCycle({
      spawn: input.spawn,
      beadId,
      sessionId: deps.sessionId,
      universe,
      verifierInputFor: (t) => `Re-verify ${t.intent_path} in ${t.claimant}.`,
    });
    if (!long.success) return long;
    if (long.value.kind === "confirmed_reject") {
      continue; // re-enter Step 4 with the regressed intent (lifetime continues)
    }

    // ---- Step 6: Test execution. ----
    setBeadStatus(input.run, beadId, "test_execution", "Step 6 — test execution");
    const executedTestIntents: string[] = [];
    let reentered = false;
    for (const testIntent of input.testIntents) {
      const tr = await runTestRunner({
        spawn: input.spawn,
        index: snapshot.index,
        beadId,
        sessionId: deps.sessionId,
        testIntentPath: testIntent,
        prepassInput: (claim) => `Does the test in ${claim.file} verify ${claim.coveredTriples.join(", ")}?`,
        cwd: deps.rootDir,
        vitestRunner: deps.vitestRunner,
      });
      if (!tr.success) return tr;
      if (tr.value.kind === "reenter_step4") {
        reentered = true;
        break;
      }
      executedTestIntents.push(testIntent);
    }
    if (reentered) continue; // a rejected test re-enters Step 4

    // ---- Step 7: Atomic commit. ----
    setBeadStatus(input.run, beadId, "committing", "Step 7 — commit");
    const commit = commitBead({
      worktreePath: input.worktreePath,
      subject: `feat: ${input.primaryIntent}`,
      trailers: { ...baseTrailers(beadId, input.node.intent_paths, snapshot, deps), test_intents: executedTestIntents },
    });
    if (!commit.success) return commit;
    setBeadStatus(input.run, beadId, "done", "Step 7 — committed");
    return ok({ commitSha: commit.value.commit_sha, status: "done", exitIter: lifetimeIter, testIntentsExecuted: executedTestIntents, lowConfidenceSupports });
  }
}

/**
 * Resume an L3-frozen bead (§recovery-ladder; 14.5 / P3-T12b). Reads the
 * preserved freeze-state.json resume record, rebuilds the run's snapshot + bound
 * spawn, and re-runs the bead's Step-4 entry from the frozen lifetime iteration —
 * continuing through Steps 5-9 and merge to a summary (or a subsequent error).
 */
export async function resumeFrozenBead(beadId: string, deps: RunImplementDeps): Promise<RuntimeResult<ImplementSummary>> {
  const startedAt = deps.clock.now();
  const resumePath = freezeResumePath(deps.rootDir, beadId);
  if (!existsSync(resumePath)) {
    return err(duskError("bead_frozen", `no frozen resume record at ${resumePath}`, { recoverable: false, bead_id: beadId }));
  }
  const record = JSON.parse(readFileSync(resumePath, "utf8")) as { bead_id: string; intent_paths: string[]; lifetime_iter: number; branch: string };

  const snapshot = getOrBuildSnapshot(deps.sessionId, { repoDir: deps.rootDir, baseRef: deps.baseRef, buildIndex: deps.buildIndex, resolveCommit: deps.resolveCommit }, { rebuildIndex: deps.rebuildIndex });
  const run = startActiveRun(deps.sessionId, snapshot);
  const spawn: BoundSpawn = (params) => spawnSubAgent(params, { rootDir: deps.rootDir, env: deps.env, clock: deps.clock, taskRunner: deps.taskRunner, verifierFactory: deps.verifierFactory, ...(deps.traceSink ? { traceSink: deps.traceSink } : {}), indexSnapshotId: snapshot.id });

  try {
    const node = { intent_paths: record.intent_paths, predicted_files: [] as string[] };
    const suffixes = testPyramidSuffixes(deps.config);
    const testIntents = record.intent_paths.filter((p) => suffixes.includes(p.split("/").at(-1) ?? ""));
    upsertBead(run, { id: beadId, status: "short_cycle", current_step: "Step 4 — resumed from freeze", started_at: new Date(deps.clock.now()).toISOString(), branch: record.branch });

    const result = await processBead({
      beadId,
      worktreePath: worktreePathFor(deps.rootDir, beadId),
      primaryIntent: record.intent_paths[0],
      testIntents,
      node,
      snapshot,
      run,
      deps,
      spawn,
      lifetimeStart: record.lifetime_iter,
    });
    if (!result.success) return result;

    const merged = runMerge({ repoDir: deps.rootDir, dag: { nodes: [{ bead_id: beadId, intent_paths: record.intent_paths, predicted_files: [] }], edges: [] } });
    if (!merged.success) return merged;

    return ok(
      assembleSummary({
        commits: [{ bead_id: beadId, commit_sha: result.value.commitSha, branch: record.branch }],
        beads: [{ bead_id: beadId, status: result.value.status, exit_iter: result.value.exitIter }],
        intentsTouched: record.intent_paths,
        testIntentsExecuted: result.value.testIntentsExecuted,
        traceIds: [],
        totalDurationMs: Math.max(0, deps.clock.now() - startedAt),
        totalCostUsd: 0,
        lowConfidenceSupports: result.value.lowConfidenceSupports,
      }),
    );
  } finally {
    endActiveRun();
  }
}

function baseTrailers(beadId: string, intentPaths: string[], snapshot: SessionSnapshot, deps: RunImplementDeps): CommitTrailers {
  return {
    intents: intentPaths.map((intent_path) => ({ intent_path, aspect_ids: tripleIdsOf(snapshot.index, intent_path) })),
    test_intents: [],
    bead_id: beadId,
    verdict_id: `vd_${beadId}`,
    trace_id: `tr_${beadId}`,
    verifier_model: deps.verifierModel ?? "claude-sonnet-4-6",
    long_cycle_samples: 10,
    test_suites_passed: 0,
  };
}
