import { createTempRepo, fixedClock, readTraces, type TempRepo } from "@dusk/test-harness";
import { type DuskError, type Verdict, type VerifierFactory, isDuskError } from "@dusk/core-schema";
import { readRuntimeEnv, spawnSubAgent, type SpawnDeps } from "@dusk/runtime-orchestrator";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { scriptedVerdictFactory } from "./scriptedVerdictFactory.js";
import { getSpawnCount, resetSpawnCount } from "./spawnCount.js";

const verifierRole = [
  "---",
  "dusk_role_version: 2",
  "name: dusk-verifier",
  "description: test verifier",
  "tools: [Read]",
  "memory: none",
  "skills: []",
  "model: claude-sonnet-4-6",
  "---",
  "",
  "# Dusk Verifier",
  "VERIFIER-BODY",
  "",
].join("\n");

const verdict = (id: string): Verdict => ({
  intent_path: id,
  decision: "accept",
  per_triple: [],
  aggregate_rationale: `verdict ${id}`,
});

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
  repo.write(".claude/agents/dusk-verifier.md", verifierRole);
  resetSpawnCount();
});
afterEach(() => repo.cleanup());

function deps(verifierFactory: VerifierFactory): SpawnDeps {
  return {
    rootDir: repo.dir,
    env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }),
    clock: fixedClock(1_000),
    taskRunner: async () => ({ output: "" }),
    verifierFactory,
  };
}

async function spawnVerifier(factory: VerifierFactory, intentPath: string) {
  return spawnSubAgent({ role: "verifier", sessionId: "s1", input: "judge", intentPath }, deps(factory));
}

describe("4.1 — scripted-verdict factory returns verdicts in order with zero LLM cost", () => {
  test("three spawns return the three scripted verdicts; all traces are zero-cost", async () => {
    const factory = scriptedVerdictFactory([verdict("a"), verdict("b"), verdict("c")]);
    const results = [];
    for (const id of ["a", "b", "c"]) results.push(await spawnVerifier(factory, id));

    for (let i = 0; i < 3; i++) {
      const r = results[i];
      expect(r.success).toBe(true);
      if (!r.success) continue;
      expect((r.value.verdict as Verdict).intent_path).toBe(["a", "b", "c"][i]);
    }

    const traces = readTraces(repo.dir).filter((t) => t.role === "verifier");
    expect(traces).toHaveLength(3);
    for (const t of traces) {
      expect(t.prompt_tokens).toBe(0);
      expect(t.completion_tokens).toBe(0);
      expect(t.cost_usd).toBe(0);
    }
  });
});

describe("4.2 — real vs doubled verifier spawn produce the same trace shape", () => {
  test("same field set; differ only on token/latency/cost and verdict content", async () => {
    const real: VerifierFactory = async (ctx) => {
      ctx.reportUsage?.({ model: "claude-sonnet-4-6", promptTokens: 220, completionTokens: 48, costUsd: 0.0031, latencyMs: 10 });
      return verdict("real");
    };
    await spawnVerifier(real, "x");
    const realTrace = readTraces(repo.dir).at(-1)!;

    const repo2 = createTempRepo({ git: false });
    repo2.write(".claude/agents/dusk-verifier.md", verifierRole);
    await spawnSubAgent(
      { role: "verifier", sessionId: "s1", input: "judge", intentPath: "x" },
      { rootDir: repo2.dir, env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }), clock: fixedClock(1_000), taskRunner: async () => ({ output: "" }), verifierFactory: scriptedVerdictFactory([verdict("dbl")]) },
    );
    const doubleTrace = readTraces(repo2.dir).at(-1)!;
    repo2.cleanup();

    expect(Object.keys(doubleTrace).sort()).toEqual(Object.keys(realTrace).sort());
    expect(realTrace.prompt_tokens).toBeGreaterThan(0);
    expect(doubleTrace.prompt_tokens).toBe(0);
    expect(doubleTrace.cost_usd).toBe(0);
  });
});

describe("4.3 — spawn-counter telemetry", () => {
  test("five verifier spawns advance the counter to five; reset clears it", async () => {
    const factory = scriptedVerdictFactory(Array.from({ length: 5 }, (_, i) => verdict(`v${i}`)));
    for (let i = 0; i < 5; i++) await spawnVerifier(factory, `v${i}`);
    expect(getSpawnCount()).toBe(5);
    resetSpawnCount();
    expect(getSpawnCount()).toBe(0);
  });
});

describe("4.4 — honest exhaustion", () => {
  test("a third spawn against a 2-verdict script returns a structural error, not a default verdict", async () => {
    const factory = scriptedVerdictFactory([verdict("a"), verdict("b")]);
    await spawnVerifier(factory, "a");
    await spawnVerifier(factory, "b");
    const third = await spawnVerifier(factory, "c");

    expect(third.success).toBe(true);
    if (!third.success) return;
    const out = third.value.verdict as DuskError;
    expect(isDuskError(out)).toBe(true);
    expect(out.kind).toBe("internal_error");
    expect(out.recoverable).toBe(false);
  });
});
