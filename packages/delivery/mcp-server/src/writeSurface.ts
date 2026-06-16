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
  type GateResult,
} from "@dusk/runtime-orchestrator";
import { runCancel, setCancelFlag, type CancelTargets } from "@dusk/runtime-cancel";
import { resolveLivelock } from "@dusk/runtime-livelock-detection";
import { runTestRunner, type VitestRunner } from "@dusk/runtime-test-runner";
import type { AuthorStage, CancelResult, DialogInit, LivelockResolutionVerb, SpawnOutcome } from "@dusk/core-schema";
import type { AuthorRuntime } from "@dusk/runtime-author";

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
  /** Phase 4: the Author runtime `modify_triple` opens its scoped dialog through. */
  authorRuntime?: AuthorRuntime;
  /**
   * The headless engineer's mechanical gate (post-hoc `gateWorktreeEdits` over
   * the worktree diff). A LIVE MCP `dusk_implement` that runs a real
   * file-writing engineer MUST supply this — without it the short cycle runs
   * UNGATED (the CLI always wires it). The MCP write surface is not yet
   * constructed with a file-writing engineer in any live entrypoint
   * (createDuskMcpServer is given `write` deps only in tests), so this is
   * forwarded-and-required-by-contract rather than a live path today.
   */
  gate?: (engineer: SpawnOutcome) => GateResult;
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
    // Forward the engineer gate — a live file-writing MCP wiring must supply it
    // (see WriteSurfaceDeps.gate); omitting it runs the cycle ungated.
    gate: deps.gate,
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

export type LivelockResolutionResponse =
  | { verb: "accept_test_as_is"; bypass: { test_intent_path: string; triple_id: string } }
  | { verb: "modify_triple"; dialog_id: string; stage: AuthorStage; next_question: string }
  | { verb: "escalate" };

/**
 * `dusk_resolve_livelock({bead_id, verb, dialog_init?})` — Phase-4 HARD CUTOVER
 * (design D5): the Phase-3 inline `payload` parameter is REMOVED; callers
 * passing it receive `config_invalid` pointing at the new `dialog_init` flow.
 * `modify_triple` opens a scoped Author dialog seeded from the report's
 * `failing_triple` and returns the `dialog_id` for the harness to drive.
 */
export async function duskResolveLivelock(
  deps: WriteSurfaceDeps,
  args: { bead_id: string; verb: LivelockResolutionVerb; dialog_init?: DialogInit; payload?: unknown },
): Promise<RuntimeResult<LivelockResolutionResponse>> {
  if (args.payload !== undefined) {
    return err(
      duskError("config_invalid", "the inline `payload` parameter was removed from dusk_resolve_livelock in Phase 4", {
        recoverable: true,
        bead_id: args.bead_id,
        recovery_hint: 'modify_triple now opens a scoped Author dialog: call dusk_resolve_livelock({bead_id, verb: "modify_triple"}) and drive the returned dialog_id via dusk_author_continue / dusk_author_finalize (dialog_init seeds it automatically)',
      }),
    );
  }
  const report = deps.livelockReports?.get(args.bead_id);
  if (!report) {
    return err(duskError("internal_error", `no active livelock report for bead ${args.bead_id}`, { recoverable: false, bead_id: args.bead_id }));
  }
  const resolution = resolveLivelock(report, args.verb);
  if (!resolution.success) return resolution;
  if (resolution.value.verb !== "modify_triple") return ok(resolution.value);

  if (!deps.authorRuntime) {
    return err(
      duskError("config_invalid", "modify_triple requires the Author runtime to be wired (Phase-4 author surface)", {
        recoverable: false,
        bead_id: args.bead_id,
      }),
    );
  }
  const opened = await deps.authorRuntime.start({
    request: `Edit the failing triple of ${report.test_intent_path} (livelock on ${report.failing_triple_id})`,
    entry_mode: "scoped_triple_edit",
    dialog_init: { ...resolution.value.open_dialog.dialog_init, ...(args.dialog_init ?? {}) },
  });
  if (!opened.success) return opened;
  return ok({ verb: "modify_triple", dialog_id: opened.value.dialog_id, stage: opened.value.stage, next_question: opened.value.next_question });
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
