import { z } from "zod";

/**
 * Sub-agent trace event — RFC App. A.6. Emitted to `.ia/observability/traces.jsonl`
 * on every spawn. Phase 2 populates the core metrics + `skills_loaded[]` +
 * `iteration_number?` + the test/benchmark-only `raw_prompt`. `index_snapshot_id`
 * is reserved (set in Phase 3). Diagnosis routing: `convergence_diagnosis_present`
 * appears ONLY on Bead-Orchestrator traces, NEVER on Verifier traces.
 */

export const SUB_AGENT_ROLES = [
  "root-orchestrator",
  "bead-orchestrator",
  "decomposer",
  "scout",
  "engineer",
  "verifier",
  "test-runner",
  "author",
  "conflict-resolver",
] as const;
export const SubAgentRoleSchema = z.enum(SUB_AGENT_ROLES);
export type SubAgentRole = z.infer<typeof SubAgentRoleSchema>;

export const INVOCATION_SITES = [
  "implement",
  "author",
  "short-cycle",
  "long-cycle",
  "test-execution",
  "merge",
] as const;
export const InvocationSiteSchema = z.enum(INVOCATION_SITES);
export type InvocationSite = z.infer<typeof InvocationSiteSchema>;

export const SubAgentTraceSchema = z
  .object({
    schema_version: z.literal(1),
    trace_id: z.string(),
    bead_id: z.string().optional(),
    parent_trace_id: z.string().optional(),
    role: SubAgentRoleSchema,
    invocation_site: InvocationSiteSchema,

    // Resource metrics
    model: z.string(),
    prompt_tokens: z.number().int(),
    completion_tokens: z.number().int(),
    latency_ms: z.number(),
    cost_usd: z.number(),
    input_summary: z.record(z.unknown()).optional(),
    output_summary: z.record(z.unknown()).optional(),

    // Index coherency (reserved in Phase 2; set in Phase 3)
    index_snapshot_id: z.string().optional(),

    // Short-cycle debugging
    iteration_number: z.number().int().optional(),

    // Bead-Orchestrator traces only — diagnosis lives here, NEVER on Verifier traces
    convergence_diagnosis_present: z.boolean().optional(),

    // Phase-3 bead-lifecycle fields (Bead-Orchestrator scope). Stuckness detector
    // firing + livelock signal live ONLY on Bead-Orchestrator traces (asymmetry).
    stuckness_detector_state: z.object({ fired: z.boolean() }).strict().optional(),
    verifier_livelock_signal: z.boolean().optional(),

    // Long-cycle confirmation-pass correlation (design D5). The original reject
    // trace + its N=2 confirmation spawns share `confirmation_of_trace_id`; the
    // original event records the aggregated `confirmation_pass_outcome`.
    confirmation_of_trace_id: z.string().optional(),
    confirmation_pass_outcome: z.enum(["confirmed_reject", "flaky_verdict_dismissed"]).optional(),

    // Skill usage (advisory-scope post-hoc audit, §9.7)
    skills_loaded: z.array(z.string()).optional(),

    // Test/benchmark-mode verbatim assembled system prompt (redacted before serialize)
    raw_prompt: z.string().optional(),
  })
  .strict();
export type SubAgentTrace = z.infer<typeof SubAgentTraceSchema>;
