import type { DerivedIndex } from "@dusk/core-index";
import {
  duskError,
  err,
  ok,
  type DuskConfig,
  type RuntimeResult,
  type TestVerifierLivelockReport,
  type VerifierFactory,
} from "@dusk/core-schema";
import {
  runImplement,
  spawnSubAgent,
  type BoundSpawn,
  type RunImplementRequest,
  type TaskRunner,
  type RuntimeEnv,
  type ImplementSummary,
} from "@dusk/runtime-orchestrator";
import { runCancel, setCancelFlag, type CancelTargets } from "@dusk/runtime-cancel";
import { resolveLivelock, type LivelockResolution } from "@dusk/runtime-livelock-detection";
import { runTestRunner, type VitestRunner } from "@dusk/runtime-test-runner";
import type { CancelResult } from "@dusk/core-schema";

/**
 * The Phase-3 MCP write surface (13.1–13.4): `dusk_implement`, `dusk_cancel`,
 * `dusk_resolve_livelock`, and the `/dusk-test` standalone Test Runner. Each is a
 * thin wrapper that assembles the runtime deps from an injected `WriteSurfaceDeps`
 * (model/git/Vitest primitives) and delegates to the runtime packages. The deps
 * are injected so the surface runs zero-model under the scripted-verdict double
 * and against real deps in production.
 */

export type Clock = { now: () => number };

export type WriteSurfaceDeps = {
  rootDir: string;
  sessionId: string;
  env: RuntimeEnv;
  taskRunner: TaskRunner;
  verifierFactory: VerifierFactory;
  buildIndex: () => DerivedIndex;
  clock: Clock;
  config: DuskConfig;
  perEntryMax: number;
  lifetimeMax: number;
  vitestRunner?: VitestRunner;
  baseRef?: string;
  /** Active livelock reports awaiting resolution, keyed by bead-id (in-process). */
  livelockReports?: Map<string, TestVerifierLivelockReport>;
  /** Targets the cancel pass should reap (assembled by the harness/orchestrator). */
  cancelTargets?: () => CancelTargets;
};

/** `dusk_implement({request? | resume_token?, scope_hint?})` → Step-9 summary or DuskError. */
export async function duskImplement(deps: WriteSurfaceDeps, req: RunImplementRequest): Promise<RuntimeResult<ImplementSummary>> {
  return runImplement(req, {
    rootDir: deps.rootDir,
    sessionId: deps.sessionId,
    env: deps.env,
    taskRunner: deps.taskRunner,
    verifierFactory: deps.verifierFactory,
    buildIndex: deps.buildIndex,
    clock: deps.clock,
    config: deps.config,
    perEntryMax: deps.perEntryMax,
    lifetimeMax: deps.lifetimeMax,
    vitestRunner: deps.vitestRunner,
    baseRef: deps.baseRef,
  });
}

/** `dusk_cancel({bead_id?, reason})` → CancelResult (flag-and-drain). */
export function duskCancel(deps: WriteSurfaceDeps, args: { bead_id?: string; reason: string }): RuntimeResult<CancelResult> {
  setCancelFlag(args.reason, args.bead_id);
  const targets = deps.cancelTargets ? deps.cancelTargets() : { beadIds: args.bead_id ? [args.bead_id] : [] };
  const { result, informational } = runCancel({
    rootDir: deps.rootDir,
    reason: args.reason,
    targets,
    inFlightTasksDrained: 0,
    traceId: `tr_cancel_${deps.clock.now()}`,
    drainDurationMs: 0,
  });
  // `cancellation_already_committed` is informational — surface it with the result attached.
  if (informational) return err({ ...informational, details: { ...informational.details, cancel_result: result } });
  return ok(result);
}

/** `dusk_resolve_livelock({bead_id, verb, payload?})` → resolution instruction or DuskError. */
export function duskResolveLivelock(
  deps: WriteSurfaceDeps,
  args: { bead_id: string; verb: "accept_test_as_is" | "modify_triple" | "escalate"; payload?: { edited_triple?: never } },
): RuntimeResult<LivelockResolution> {
  const report = deps.livelockReports?.get(args.bead_id);
  if (!report) {
    return err(duskError("internal_error", `no active livelock report for bead ${args.bead_id}`, { recoverable: false, bead_id: args.bead_id }));
  }
  return resolveLivelock(report, args.verb, args.payload as never);
}

/** `/dusk-test <scope>` — standalone Test Runner over a scope (ephemeral synthetic bead-id). */
export async function duskTest(deps: WriteSurfaceDeps, scope: string) {
  // Ephemeral synthetic bead-id: no persistent state under .ia/runtime/beads/.
  const syntheticBeadId = `bd_test_${deps.clock.now()}`;
  const spawn: BoundSpawn = (params) =>
    spawnSubAgent(params, {
      rootDir: deps.rootDir,
      env: deps.env,
      clock: deps.clock,
      taskRunner: deps.taskRunner,
      verifierFactory: deps.verifierFactory,
    });
  return runTestRunner({
    spawn,
    index: deps.buildIndex(),
    beadId: syntheticBeadId,
    sessionId: deps.sessionId,
    testIntentPath: scope,
    prepassInput: (claim) => `Does the test in ${claim.file} verify ${claim.coveredTriples.join(", ")}?`,
    cwd: deps.rootDir,
    vitestRunner: deps.vitestRunner,
  });
}
