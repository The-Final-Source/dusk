import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";
import { DuskConfigSchema, SubAgentTraceSchema, type Intent, type VerifierFactory } from "@dusk/core-schema";
import {
  createMockGitWorktree,
  fixedClock,
  makeScriptedVerdictFactory,
  makeVitestJsonReportString,
  readTraces,
  type MockGitWorktree,
} from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { readRuntimeEnv } from "./env.js";
import { clearSnapshot } from "./snapshot.js";
import { runImplement, type RunImplementDeps } from "./stateMachine.js";

// P5-T1 — every sub-agent call emits one fully-populated SubAgentTrace.
// One pipeline run (zero-model, scripted-verdict double) exercises a stuckness
// fire (short cycle), a long-cycle confirmation pass, and a livelock detection;
// traces.jsonl is then read back and audited for the v9 field matrix.

const role = (slug: string, memory: string): string =>
  ["---", "dusk_role_version: 2", `name: dusk-${slug}`, "description: t", "tools: [Read, Edit]", `memory: ${memory}`, "skills: []", "model: claude-sonnet-4-6", "---", "", `# ${slug}`, ""].join("\n");

const mkIntent = (id: string, triple: string): Intent => ({
  schema_version: 2,
  id,
  description: id,
  obligation: "must",
  compose: "all",
  triples: [{ id: triple, subject: "s", predicate: "p", object: "o", polarity: "positive" }],
  relates_to: [],
});

const rec = (file: string, marker: DecorationRecord["marker"], intentPath: string, decl: string, aspects: string[]): DecorationRecord => ({
  file,
  line: 1,
  scope: "declaration",
  declaration_name: decl,
  marker,
  intent_path: intentPath,
  aspect_ids: aspects,
  support_triple: null,
  ignore_clause: null,
});

function buildIndex(): DerivedIndex {
  return buildDerivedIndex(
    [
      rec("src/widget.ts", "intent", "api/widget", "widget", ["shape"]),
      rec("src/widget.unit.test.ts", "intent-test", "api/widget/unit-tests", "t", ["covers-shape"]),
    ],
    new Map([
      ["api/widget", mkIntent("api/widget", "shape")],
      ["api/widget/unit-tests", mkIntent("api/widget/unit-tests", "covers-shape")],
    ]),
  );
}

const tripleVerdict = (tripleId: string, focal: "pass" | "fail") => ({
  triple_id: tripleId,
  focal_verdict: focal,
  support_quality: "ok" as const,
  polarity: "positive" as const,
  evidence: { support_claims: [] },
  rationale: focal === "fail" ? `${tripleId} not satisfied` : `${tripleId} satisfied`,
});

let mg: MockGitWorktree;
beforeEach(() => {
  clearSnapshot("p5t1");
  mg = createMockGitWorktree({ idBase: "20260611140000" });
  mkdirSync(join(mg.repoDir, ".claude/agents"), { recursive: true });
  for (const [slug, memory] of [["engineer", "bead"], ["verifier", "none"], ["bead", "bead"], ["test-runner", "bead"]] as const) {
    writeFileSync(join(mg.repoDir, ".claude/agents", `dusk-${slug}.md`), role(slug, memory));
  }
});
afterEach(() => {
  clearSnapshot("p5t1");
  mg.cleanup();
});

describe("P5-T1 — a pipeline exercising stuckness, confirmation, and livelock produces a complete trace stream", () => {
  test("one event per call; v9 field matrix per role/site; diagnosis flag never on Verifier events", async () => {
    // Scripted verdicts:
    //  - impl short cycle: reject iters 1-3 on the SAME failing triple (stuckness
    //    fires at iter 3), accept at iter 4.
    //  - impl long cycle: first sampled verdict rejects → N=2 confirmation pass;
    //    both confirmations accept → flaky_verdict_dismissed.
    //  - test-bead pre-pass: always rejects with an object-slot-concentrated
    //    rationale → three re-entries → livelock fires.
    let implLongCalls = 0;
    const factory: VerifierFactory = makeScriptedVerdictFactory((ctx) => {
      const p = ctx.assembledPrompt;
      if (p.includes("Does the test in")) {
        return {
          intent_path: ctx.intentPath,
          decision: "reject",
          per_triple: [],
          aggregate_rationale: "the test leaves the object slot unconstrained",
        };
      }
      if (p.includes("Re-verify api/widget/unit-tests")) {
        return { intent_path: ctx.intentPath, decision: "accept", per_triple: [], aggregate_rationale: "ok" };
      }
      if (p.includes("Re-verify api/widget ")) {
        implLongCalls += 1;
        return implLongCalls === 1
          ? { intent_path: ctx.intentPath, decision: "reject", per_triple: [tripleVerdict("shape", "fail")], aggregate_rationale: "regression suspected" }
          : { intent_path: ctx.intentPath, decision: "accept", per_triple: [tripleVerdict("shape", "pass")], aggregate_rationale: "ok" };
      }
      if (p.includes("Evaluate the focal claims of api/widget/unit-tests")) {
        return { intent_path: ctx.intentPath, decision: "accept", per_triple: [tripleVerdict("covers-shape", "pass")], aggregate_rationale: "ok" };
      }
      if (p.includes("Evaluate the focal claims of api/widget ")) {
        const failing = (ctx.iterationNumber ?? 1) <= 3;
        return failing
          ? { intent_path: ctx.intentPath, decision: "reject", per_triple: [tripleVerdict("shape", "fail")], aggregate_rationale: "shape unsatisfied" }
          : { intent_path: ctx.intentPath, decision: "accept", per_triple: [tripleVerdict("shape", "pass")], aggregate_rationale: "ok" };
      }
      return { intent_path: ctx.intentPath, decision: "accept", per_triple: [], aggregate_rationale: "ok" };
    });

    let taskRunnerCalls = 0;
    let verifierCalls = 0;
    const countingFactory: VerifierFactory = (ctx) => {
      verifierCalls += 1;
      return factory(ctx);
    };

    const deps: RunImplementDeps = {
      rootDir: mg.repoDir,
      sessionId: "p5t1",
      env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }),
      taskRunner: async () => {
        taskRunnerCalls += 1;
        return { output: "drafted the widget shape change", model: "claude-sonnet-4-6", promptTokens: 1, completionTokens: 1, costUsd: 0, latencyMs: 1 };
      },
      verifierFactory: countingFactory,
      buildIndex,
      clock: fixedClock(1_000),
      config: DuskConfigSchema.parse({}),
      perEntryMax: 20,
      lifetimeMax: 40,
      vitestRunner: (files) => makeVitestJsonReportString(files.map((f) => ({ file: f, title: "t", status: "passed" as const, duration: 1 }))),
    };

    const result = await runImplement({ request: "add the api/widget shape", scopeHint: ["api/widget"] }, deps);

    // The run ends paused for the Test-Verifier livelock (the scripted end state).
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.message).toMatch(/livelock/);

    const traces = readTraces(mg.repoDir);

    // ---- One event per sub-agent call; every event schema-valid. ----
    expect(traces.length).toBe(taskRunnerCalls + verifierCalls);
    expect(new Set(traces.map((t) => t.trace_id)).size).toBe(traces.length);
    for (const t of traces) SubAgentTraceSchema.parse(t);

    // ---- Universal fields: index_snapshot_id + skills_loaded on every event. ----
    const ids = new Set(traces.map((t) => t.index_snapshot_id));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[0-9a-f]{64}$/);
    for (const t of traces) expect(Array.isArray(t.skills_loaded)).toBe(true);

    // ---- Short-cycle stuck-bead fields on the impl bead's orchestrator ticks. ----
    const implTicks = traces
      .filter((t) => t.role === "bead-orchestrator" && t.invocation_site === "short-cycle" && (t.failing_triple_set ?? []).includes("shape"))
      .sort((a, b) => (a.iteration_number ?? 0) - (b.iteration_number ?? 0));
    expect(implTicks.length).toBe(3); // iters 1-3 failing

    const iter1 = implTicks[0];
    expect(iter1.iteration_number).toBe(1);
    expect(iter1.verdict_delta_from_prior).toEqual({ flipped_triples: [], new_failures: ["shape"], new_passes: [] });
    expect(iter1.engineer_change_summary).toBe("drafted the widget shape change");
    expect(iter1.stuckness_detector_state).toEqual({ fired: false });

    const iter3 = implTicks[2];
    expect(iter3.iteration_number).toBe(3);
    expect(iter3.stuckness_detector_state).toEqual({ fired: true });
    expect(iter3.convergence_diagnosis_present).toBe(true);
    expect(iter3.verdict_delta_from_prior).toEqual({ flipped_triples: [], new_failures: [], new_passes: [] });

    const iter4 = traces.find((t) => t.role === "bead-orchestrator" && t.iteration_number === 4 && t.invocation_site === "short-cycle");
    expect(iter4).toBeDefined();
    expect(iter4!.failing_triple_set).toEqual([]);
    expect(iter4!.verdict_delta_from_prior).toEqual({ flipped_triples: ["shape"], new_failures: [], new_passes: ["shape"] });

    // ---- Long-cycle confirmation pass: 2 confirmation events correlate to the
    //      original reject; the completing one records the aggregated outcome. ----
    const confirmations = traces.filter((t) => t.confirmation_of_trace_id !== undefined);
    expect(confirmations.length).toBe(2);
    const originalId = confirmations[0].confirmation_of_trace_id!;
    expect(confirmations.every((t) => t.confirmation_of_trace_id === originalId)).toBe(true);
    expect(traces.some((t) => t.trace_id === originalId && t.role === "verifier" && t.invocation_site === "long-cycle")).toBe(true);
    const outcomes = confirmations.map((t) => t.confirmation_pass_outcome).filter(Boolean);
    expect(outcomes).toEqual(["flaky_verdict_dismissed"]);

    // ---- Livelock event: exactly one, Bead-Orchestrator scope only. ----
    const livelockEvents = traces.filter((t) => t.verifier_livelock_signal === true);
    expect(livelockEvents.length).toBe(1);
    expect(livelockEvents[0].role).toBe("bead-orchestrator");
    expect(livelockEvents[0].invocation_site).toBe("test-execution");

    // ---- Asymmetry: diagnosis/stuckness/livelock fields NEVER on Verifier events. ----
    for (const v of traces.filter((t) => t.role === "verifier")) {
      expect(v.convergence_diagnosis_present).toBeUndefined();
      expect(v.stuckness_detector_state).toBeUndefined();
      expect(v.verifier_livelock_signal).toBeUndefined();
      expect(v.verdict_delta_from_prior).toBeUndefined();
      expect(v.engineer_change_summary).toBeUndefined();
    }
  });
});
