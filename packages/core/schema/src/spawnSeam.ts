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
