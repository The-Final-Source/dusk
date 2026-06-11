import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  type RuntimeResult,
  type SubAgentTrace,
  type VerifierFactory,
  type VerifierResult,
  type VerifierUsage,
  type SpawnParams,
  type SpawnOutcome,
  duskError,
  isDuskError,
} from "@dusk/core-schema";
import { materializeMemory, type MemoryScope } from "@dusk/runtime-memory";
import { loadSkills, renderSkillsBlock } from "@dusk/runtime-skills";
import { resolveToolScope } from "@dusk/runtime-tool-scope";

import { capturesRawPrompt, type RuntimeEnv } from "./env.js";
import { redact, redactDeep } from "./redaction.js";
import { checkRoleVersion, loadRoleFile, subagentType } from "./roleFile.js";

/** Structurally compatible with `@dusk/test-harness`'s Clock (injectable time). */
export type Clock = { now: () => number };

/** The Claude Code Task tool, abstracted for injection (production bridges to the real tool). */
export type TaskCall = { subagentType: string; prompt: string; tools: string[] };
export type TaskResult = {
  output: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  costUsd?: number;
};
export type TaskRunner = (call: TaskCall) => Promise<TaskResult>;

export type TraceSink = (trace: SubAgentTrace) => void;

// `SpawnParams` / `SpawnOutcome` are pinned in `@dusk/core-schema` (the spawn
// seam) so Phase-3 step packages can build/consume them without importing this
// package. Re-exported here for back-compat with existing consumers.
export type { SpawnParams, SpawnOutcome, BoundSpawn } from "@dusk/core-schema";

export type SpawnDeps = {
  rootDir: string;
  env: RuntimeEnv;
  clock: Clock;
  taskRunner: TaskRunner;
  /** Used for `role: "verifier"` spawns; required for verifier roles. */
  verifierFactory?: VerifierFactory;
  /** Overridable trace sink (defaults to appending `.ia/observability/traces.jsonl`). */
  traceSink?: TraceSink;
  /** Deterministic trace-id generator (defaults to a clock + counter scheme). */
  traceId?: () => string;
  /**
   * The run's session-snapshot id (RFC §2.10; design D1). When present it is
   * stamped onto every emitted trace, so every spawn in a run carries the same
   * `index_snapshot_id` (Phase 2 reserved the field; Phase 3 sets it).
   */
  indexSnapshotId?: string;
};

let traceCounter = 0;
function defaultTraceId(clock: Clock): string {
  traceCounter += 1;
  return `tr_${clock.now()}${String(traceCounter).padStart(4, "0")}`;
}

function appendTrace(rootDir: string, trace: SubAgentTrace): void {
  const path = join(rootDir, ".ia/observability/traces.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(trace)}\n`, "utf8");
}

/** Deterministic prompt assembly: role body + injected skills + prior state + input. */
export function assemblePrompt(parts: {
  roleBody: string;
  skillsBlock: string;
  memoryRendering: string;
  input: string;
}): string {
  const sections = [parts.roleBody];
  if (parts.skillsBlock.trim().length > 0) sections.push(`## Injected skills\n\n${parts.skillsBlock}`);
  if (parts.memoryRendering.trim().length > 0) sections.push(`## Prior state\n\n${parts.memoryRendering.trim()}`);
  sections.push(`## Input\n\n${parts.input}`);
  return sections.join("\n\n");
}

const hasDiagnosis = (rendering: string): boolean => {
  const match = rendering.match(/## Current diagnosis\n([\s\S]*?)(?:\n## |$)/);
  if (!match) return false;
  const body = match[1].trim();
  return body.length > 0 && body !== "(none)";
};

/**
 * The three-stage deterministic spawn assembler (RFC §9.9; design D1):
 *   1. memory load  →  2. skills inject  →  3. system-prompt assembly
 * then the Task call (`subagent_type: dusk-<role>`) — or, for `role: "verifier"`,
 * the injected `VerifierFactory`. Emits exactly one `SubAgentTrace`.
 *
 * Failures before the spawn (missing role file, out-of-range version, missing
 * verifier factory) return a typed error and emit NO Task call / trace.
 */
export async function spawnSubAgent(params: SpawnParams, deps: SpawnDeps): Promise<RuntimeResult<SpawnOutcome>> {
  const { role, sessionId, input } = params;
  const { rootDir, env, clock } = deps;
  const sink = deps.traceSink ?? ((trace: SubAgentTrace) => appendTrace(rootDir, trace));
  const mkTraceId = deps.traceId ?? (() => defaultTraceId(clock));

  // Stage 0: role file + version enforcement (before any spawn).
  const roleResult = loadRoleFile(rootDir, role);
  if (!roleResult.success) return roleResult;
  const { frontmatter, body: roleBody } = roleResult.value;
  const versionError = checkRoleVersion(role, frontmatter);
  if (versionError) return { success: false, error: versionError };

  if (role === "verifier" && !deps.verifierFactory) {
    return {
      success: false,
      error: duskError("internal_error", "verifier spawn requires a verifierFactory (none injected)", { recoverable: false }),
    };
  }

  // Stage 1: memory load (per the role's declared scope).
  const memory = materializeMemory({
    rootDir,
    scope: frontmatter.memory as MemoryScope,
    role,
    ids: { beadId: params.beadId, dialogId: params.dialogId, sessionId },
  });

  // Stage 2: skill injection (only the declared skills).
  const loadedSkills = loadSkills(rootDir, frontmatter.skills);
  const skillsBlock = renderSkillsBlock(loadedSkills);
  const toolScope = resolveToolScope(frontmatter.tools);

  // Stage 3: system-prompt assembly (verbatim string passed onward).
  const assembledPrompt = assemblePrompt({ roleBody, skillsBlock, memoryRendering: memory.rendering, input });

  const startedAt = clock.now();
  const traceId = mkTraceId();

  let output: string | undefined;
  let verdict: VerifierResult | undefined;
  let model = frontmatter.model ?? "unknown";
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;

  if (role === "verifier") {
    let usage: VerifierUsage | undefined;
    verdict = await deps.verifierFactory!({
      intentPath: params.intentPath ?? "",
      aspectId: params.aspectId,
      sessionId,
      beadId: params.beadId,
      iterationNumber: params.iterationNumber,
      assembledPrompt,
      input,
      reportUsage: (u) => {
        usage = u;
      },
    });
    if (usage) {
      model = usage.model;
      promptTokens = usage.promptTokens;
      completionTokens = usage.completionTokens;
      costUsd = usage.costUsd;
    }
  } else {
    const result = await deps.taskRunner({ subagentType: subagentType(role), prompt: assembledPrompt, tools: toolScope.tools });
    output = result.output;
    model = result.model ?? model;
    promptTokens = result.promptTokens ?? 0;
    completionTokens = result.completionTokens ?? 0;
    costUsd = result.costUsd ?? 0;
  }

  const latencyMs = Math.max(0, clock.now() - startedAt);

  // The completing long-cycle confirmation spawn derives the aggregated outcome
  // from its own verdict (P5-T1) — the prior confirmation's decision is closed
  // over by the long cycle, so no already-emitted event needs mutation.
  const confirmationPassOutcome =
    params.beadLifecycle?.confirmation_pass_outcome ??
    (params.confirmationOutcomeFromVerdict && verdict && !isDuskError(verdict)
      ? params.confirmationOutcomeFromVerdict(verdict.decision)
      : undefined);

  const trace: SubAgentTrace = {
    schema_version: 1,
    trace_id: traceId,
    ...(params.beadId ? { bead_id: params.beadId } : {}),
    role,
    invocation_site: params.invocationSite ?? "implement",
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    latency_ms: latencyMs,
    cost_usd: costUsd,
    ...(deps.indexSnapshotId ? { index_snapshot_id: deps.indexSnapshotId } : {}),
    skills_loaded: frontmatter.skills,
    ...(params.iterationNumber !== undefined ? { iteration_number: params.iterationNumber } : {}),
    ...(role === "bead-orchestrator" ? { convergence_diagnosis_present: hasDiagnosis(memory.rendering) } : {}),
    // Phase-3 bead-lifecycle fields, when the orchestrator supplies them.
    ...(params.beadLifecycle?.stuckness_detector_state ? { stuckness_detector_state: params.beadLifecycle.stuckness_detector_state } : {}),
    ...(params.beadLifecycle?.verifier_livelock_signal !== undefined ? { verifier_livelock_signal: params.beadLifecycle.verifier_livelock_signal } : {}),
    ...(params.beadLifecycle?.confirmation_of_trace_id ? { confirmation_of_trace_id: params.beadLifecycle.confirmation_of_trace_id } : {}),
    ...(confirmationPassOutcome ? { confirmation_pass_outcome: confirmationPassOutcome } : {}),
    // v9 stuck-bead debugging fields (P5-T1) — supplied by the short cycle on Bead-Orchestrator ticks.
    ...(params.beadLifecycle?.verdict_delta_from_prior ? { verdict_delta_from_prior: params.beadLifecycle.verdict_delta_from_prior } : {}),
    ...(params.beadLifecycle?.failing_triple_set ? { failing_triple_set: params.beadLifecycle.failing_triple_set } : {}),
    ...(params.beadLifecycle?.engineer_change_summary ? { engineer_change_summary: params.beadLifecycle.engineer_change_summary } : {}),
    ...(capturesRawPrompt(env) ? { raw_prompt: redact(assembledPrompt, { repoRoot: rootDir }) } : {}),
  };

  // Defense-in-depth: redact every outgoing field before serialization (design D2).
  const redactedTrace = redactDeep(trace, { repoRoot: rootDir });
  sink(redactedTrace);

  return { success: true, value: { trace: redactedTrace, assembledPrompt, output, verdict } };
}
