import type { RuntimeResult } from "./result.js";
import type { InvocationSite, SubAgentRole, SubAgentTrace } from "./subAgentTrace.js";
import type { VerifierResult } from "./verifierSeam.js";

/**
 * The spawn-injection seam (the same acyclic-graph reasoning Phase 2 used for
 * `VerifierFactory`). `SpawnParams` / `SpawnOutcome` are pinned in the leaf so
 * the Phase-3 step packages (short-cycle, long-cycle, test-runner, …) can build
 * spawn requests and consume outcomes WITHOUT importing `@dusk/runtime-orchestrator`
 * (which would cycle the graph — the orchestrator imports the step packages).
 * The orchestrator owns the concrete `spawnSubAgent` + its `SpawnDeps`; it binds
 * the deps into a `BoundSpawn` closure and injects that downward.
 */

/**
 * Phase-3 bead-lifecycle fields the orchestrator stamps onto a spawn's trace.
 * `stuckness_detector_state` / `verifier_livelock_signal` belong ONLY on
 * Bead-Orchestrator traces (the asymmetry guarantee); `confirmation_*` correlate
 * long-cycle confirmation-pass verdicts. The spawn pipeline copies whichever
 * fields are present onto the emitted `SubAgentTrace`.
 */
export type BeadLifecycleFields = {
  stuckness_detector_state?: { fired: boolean };
  verifier_livelock_signal?: boolean;
  confirmation_of_trace_id?: string;
  confirmation_pass_outcome?: "confirmed_reject" | "flaky_verdict_dismissed";
  /** v9 stuck-bead debugging (Phase 5) — stamped on the Bead-Orchestrator tick per short-cycle iteration. */
  verdict_delta_from_prior?: { flipped_triples: string[]; new_failures: string[]; new_passes: string[] };
  failing_triple_set?: string[];
  engineer_change_summary?: string;
};

export type SpawnParams = {
  role: SubAgentRole;
  beadId?: string;
  dialogId?: string;
  sessionId: string;
  /** Step-specific input contract instance, already formatted as text. */
  input: string;
  iterationNumber?: number;
  invocationSite?: InvocationSite;
  /** For verifier spawns: the intent (and optional aspect) under evaluation. */
  intentPath?: string;
  aspectId?: string;
  /** Phase-3 bead-lifecycle fields stamped onto the emitted trace. */
  beadLifecycle?: BeadLifecycleFields;
  /**
   * Phase-5 (P5-T1): for the COMPLETING long-cycle confirmation spawn — derives
   * the aggregated `confirmation_pass_outcome` from this spawn's own verdict
   * (the prior confirmation's decision is closed over by the long cycle), so the
   * outcome lands on a trace without mutating already-emitted events.
   */
  confirmationOutcomeFromVerdict?: (decision: "accept" | "reject") => "confirmed_reject" | "flaky_verdict_dismissed";
};

export type SpawnOutcome = {
  trace: SubAgentTrace;
  assembledPrompt: string;
  /** Present for non-verifier roles (the Task tool's output). */
  output?: string;
  /** Present for verifier roles (the factory's verdict or a structural error). */
  verdict?: VerifierResult;
};

/** A `spawnSubAgent` with its deps already bound — injected into the step packages. */
export type BoundSpawn = (params: SpawnParams) => Promise<RuntimeResult<SpawnOutcome>>;
