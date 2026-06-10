import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  ok,
  type BoundSpawn,
  type SpawnParams,
  type SubAgentTrace,
  type Verdict,
} from "@dusk/core-schema";
import { materializeMemory } from "@dusk/runtime-memory";
import { createTempRepo, readTraces, tracesForRole, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { readBudgets } from "./budgets.js";
import { runShortCycle } from "./loop.js";
import { stucknessFiredAt } from "./stuckness.js";

// §6 short-cycle — zero-model (hand-rolled BoundSpawn stub over real memory).

const INTENT = "api/x";

const pass = (): Verdict => ({
  intent_path: INTENT,
  decision: "accept",
  per_triple: [{ triple_id: "t1", focal_verdict: "pass", support_quality: "ok", polarity: "positive", evidence: { support_claims: [] }, rationale: "ok" }],
  aggregate_rationale: "ok",
});
const fail = (tripleId = "t1"): Verdict => ({
  intent_path: INTENT,
  decision: "reject",
  per_triple: [{ triple_id: tripleId, focal_verdict: "fail", support_quality: "ok", polarity: "positive", evidence: { support_claims: [] }, rationale: "fail" }],
  aggregate_rationale: "fail",
});
const lowConf = (): Verdict => ({
  intent_path: INTENT,
  decision: "accept",
  per_triple: [{ triple_id: "t1", focal_verdict: "pass", support_quality: "low_confidence", polarity: "positive", evidence: { support_claims: [] }, rationale: "weak support" }],
  aggregate_rationale: "ok",
});

const roleSlug = (params: SpawnParams): string => (params.role === "bead-orchestrator" ? "bead-orchestrator" : params.role);

type Stub = { spawn: BoundSpawn; verifierSpawns: () => number };

function makeStubSpawn(rootDir: string, beadId: string, verdictFor: (iter: number) => Verdict, gate?: (iter: number) => boolean): Stub {
  let traceCtr = 0;
  let verifierSpawns = 0;
  const appendTrace = (trace: SubAgentTrace): void => {
    const p = join(rootDir, ".ia/observability/traces.jsonl");
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, `${JSON.stringify(trace)}\n`, "utf8");
  };
  const spawn: BoundSpawn = async (params) => {
    traceCtr += 1;
    const scope = params.role === "verifier" ? "none" : "bead";
    const mem = materializeMemory({ rootDir, scope, role: roleSlug(params), ids: { beadId } });
    const raw_prompt = `[${params.role}]\n${mem.rendering}\n${params.input}`;
    const trace: SubAgentTrace = {
      schema_version: 1,
      trace_id: `tr_${traceCtr}`,
      bead_id: beadId,
      role: params.role,
      invocation_site: params.invocationSite ?? "implement",
      model: "stub",
      prompt_tokens: 0,
      completion_tokens: 0,
      latency_ms: 0,
      cost_usd: 0,
      ...(params.iterationNumber !== undefined ? { iteration_number: params.iterationNumber } : {}),
      ...(params.beadLifecycle?.stuckness_detector_state ? { stuckness_detector_state: params.beadLifecycle.stuckness_detector_state } : {}),
      raw_prompt,
    };
    appendTrace(trace);
    if (params.role === "verifier") {
      verifierSpawns += 1;
      return ok({ trace, assembledPrompt: raw_prompt, verdict: verdictFor(params.iterationNumber ?? 0) });
    }
    return ok({ trace, assembledPrompt: raw_prompt, output: "drafted" });
  };
  return { spawn, verifierSpawns: () => verifierSpawns };
}

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
});
afterEach(() => repo.cleanup());

const baseDeps = (stub: Stub, over: Partial<Parameters<typeof runShortCycle>[0]> = {}) => ({
  spawn: stub.spawn,
  beadId: "bd_20260610000000001",
  sessionId: "s1",
  rootDir: repo.dir,
  intentPath: INTENT,
  perEntryMax: 20,
  lifetimeMax: 40,
  engineerInput: (fb: string | null) => `implement ${INTENT}${fb ? ` — feedback: ${fb}` : ""}`,
  verifierInput: `Evaluate ${INTENT} focal claims.`,
  ...over,
});

describe("6.1 — per-entry vs lifetime budgets (relationship, P3-T25)", () => {
  test("readBudgets enforces lifetime > per-entry", () => {
    expect(readBudgets({ version: 1, sanity: { short_cycle_max_iterations: 4, bead_lifetime_iterations: 6 } } as never).success).toBe(true);
    const bad = readBudgets({ version: 1, sanity: { short_cycle_max_iterations: 6, bead_lifetime_iterations: 4 } } as never);
    expect(bad.success).toBe(false);
  });

  test("per-entry counter resets across entries; lifetime continues; exhaustion at lifetime not per-entry", async () => {
    const stub = makeStubSpawn(repo.dir, "bd_20260610000000001", () => fail());
    const entry1 = await runShortCycle(baseDeps(stub, { perEntryMax: 4, lifetimeMax: 6, lifetimeStart: 0 }));
    expect(entry1.success).toBe(true);
    if (!entry1.success) return;
    expect(entry1.value.kind).toBe("per_entry_exhausted");
    if (entry1.value.kind !== "per_entry_exhausted") return;
    expect(entry1.value.perEntryIters).toBe(4);
    expect(entry1.value.lifetimeIters).toBe(4);

    const entry2 = await runShortCycle(baseDeps(stub, { perEntryMax: 4, lifetimeMax: 6, lifetimeStart: 4 }));
    expect(entry2.success).toBe(true);
    if (!entry2.success || entry2.value.kind !== "budget_exhausted") {
      expect(entry2.success && entry2.value.kind).toBe("budget_exhausted");
      return;
    }
    expect(entry2.value.lifetimeIters).toBe(6); // exhausted at lifetime=6
    expect(entry2.value.perEntryIters).toBe(2); // NOT at per-entry=4
  });
});

describe("6.2 — gate-fail loopback does not spawn a Verifier (P3-T24)", () => {
  test("a blocked draft re-drafts; the Verifier double's spawn count does not advance for that iter", async () => {
    // iter 1 blocked, iter 2 passes the gate and converges.
    const stub = makeStubSpawn(repo.dir, "bd_20260610000000001", () => pass());
    const result = await runShortCycle(baseDeps(stub, { gate: (eng) => ({ blocked: (eng.trace.iteration_number ?? 0) === 1, rejection: "undecorated statement" }) }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.kind).toBe("converged");
    expect(stub.verifierSpawns()).toBe(1); // only iter 2 spawned a Verifier
    const verifierTraces = tracesForRole(readTraces(repo.dir), "verifier");
    expect(verifierTraces).toHaveLength(1);
    expect(verifierTraces[0].iteration_number).toBe(2); // not iter 1
  });
});

describe("6.3 — stuckness predicate + fires at iter 3 (P3-T8 structural)", () => {
  test("stucknessFiredAt: identical non-empty last-3 fires; empty/moving does not", () => {
    expect(stucknessFiredAt([["t1"], ["t1"], ["t1"]])).toBe(true);
    expect(stucknessFiredAt([["t1"], ["t1"]])).toBe(false);
    expect(stucknessFiredAt([["t1"], ["t2"], ["t3"]])).toBe(false);
    expect(stucknessFiredAt([[], [], []])).toBe(false);
  });

  test("3 identical failing iters → exactly one diagnosis write at iter 3; bead-orchestrator trace fired; no leak", async () => {
    // identical failing triple every iter; converge at iter 6 to terminate.
    const stub = makeStubSpawn(repo.dir, "bd_20260610000000001", (iter) => (iter >= 6 ? pass() : fail("t1")));
    const result = await runShortCycle(baseDeps(stub, { diagnosisText: () => "DIAGNOSIS-SENTINEL stuck on t1" }));
    expect(result.success).toBe(true);
    if (!result.success || result.value.kind !== "converged") return;
    expect(result.value.diagnosisWrites).toBe(1);

    const traces = readTraces(repo.dir);
    const beadTraceIter3 = tracesForRole(traces, "bead-orchestrator").find((t) => t.iteration_number === 3);
    expect(beadTraceIter3?.stuckness_detector_state?.fired).toBe(true);
    // No-leak: the diagnosis text never appears in any Verifier raw_prompt.
    for (const v of tracesForRole(traces, "verifier")) expect(v.raw_prompt).not.toContain("DIAGNOSIS-SENTINEL");
  });
});

describe("6.5 — iter-5 forced diagnosis fallback (P3-T9)", () => {
  test("moving failing set: diagnosis written at iter 5, not before", async () => {
    // distinct failing triple each iter → stuckness never fires.
    const movingFail = (iter: number) => fail(`t${iter}`);
    const before5 = makeStubSpawn(repo.dir, "bd_20260610000000001", (iter) => (iter >= 4 ? pass() : movingFail(iter)));
    const r1 = await runShortCycle(baseDeps(before5));
    expect(r1.success && r1.value.kind === "converged" && r1.value.diagnosisWrites).toBe(0); // converged at iter 4, never wrote

    const repo2 = createTempRepo({ git: false });
    const at5 = makeStubSpawn(repo2.dir, "bd_20260610000000002", (iter) => (iter >= 6 ? pass() : movingFail(iter)));
    const r2 = await runShortCycle({ ...baseDeps(at5), rootDir: repo2.dir, beadId: "bd_20260610000000002" });
    expect(r2.success && r2.value.kind === "converged" && r2.value.diagnosisWrites).toBe(1); // written exactly at iter 5
    repo2.cleanup();
  });
});

describe("6.6 — iter-15 early escalation (P3-T10)", () => {
  test("15 non-converging iters surface the diagnosis as the escalation payload", async () => {
    const stub = makeStubSpawn(repo.dir, "bd_20260610000000001", () => fail("t1"), undefined);
    const result = await runShortCycle(baseDeps(stub, { perEntryMax: 20, lifetimeMax: 40, diagnosisText: () => "ESCALATION-DIAGNOSIS" }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.kind).toBe("escalated_iter15");
    if (result.value.kind !== "escalated_iter15") return;
    expect(result.value.perEntryIters).toBe(15);
    expect(result.value.diagnosis).toContain("ESCALATION-DIAGNOSIS"); // from bead memory, distinct from a bead_* error
  });
});

describe("6.7 — low_confidence support does NOT trigger re-draft (P3-T29)", () => {
  test("focal pass + support low_confidence converges in 1 iter; low-confidence surfaces", async () => {
    const stub = makeStubSpawn(repo.dir, "bd_20260610000000001", () => lowConf());
    const result = await runShortCycle(baseDeps(stub));
    expect(result.success).toBe(true);
    if (!result.success || result.value.kind !== "converged") return;
    expect(result.value.perEntryIters).toBe(1); // converged immediately
    expect(result.value.lowConfidenceSupports).toHaveLength(1);
    expect(result.value.lowConfidenceSupports[0].triple_id).toBe("t1");
  });
});

describe("6.8 — Verifier spawn payload carries no iteration-specific content", () => {
  test("every Verifier raw_prompt is identical across iterations", async () => {
    const stub = makeStubSpawn(repo.dir, "bd_20260610000000001", (iter) => (iter >= 5 ? pass() : fail("t1")));
    await runShortCycle(baseDeps(stub, { diagnosisText: () => "SECRET-DIAGNOSIS" }));
    const verifierPrompts = tracesForRole(readTraces(repo.dir), "verifier").map((t) => t.raw_prompt);
    expect(verifierPrompts.length).toBeGreaterThanOrEqual(4);
    const unique = new Set(verifierPrompts);
    expect(unique.size).toBe(1); // identical across iterations
    for (const p of verifierPrompts) expect(p).not.toContain("SECRET-DIAGNOSIS");
  });
});
