import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";
import { DuskConfigSchema, type Intent, type VerifierFactory } from "@dusk/core-schema";
import { otlpSink, runForwarderOnce, startForwarder } from "@dusk/runtime-observability";
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

// P5-T12 — an unreachable mirror sink never blocks or fails a pipeline run.
// The forwarder tails traces.jsonl out-of-band (design D4); the mocked
// unreachable sink is the one unmanaged dependency in the Phase-5 test surface.

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

const focal = (file: string, intentPath: string, decl: string, aspects: string[]): DecorationRecord => ({
  file,
  line: 1,
  scope: "declaration",
  declaration_name: decl,
  marker: "intent",
  intent_path: intentPath,
  aspect_ids: aspects,
  support_triple: null,
  ignore_clause: null,
});

const buildIndex = (): DerivedIndex =>
  buildDerivedIndex([focal("src/widget.ts", "api/widget", "widget", ["shape"])], new Map([["api/widget", mkIntent("api/widget", "shape")]]));

const accept: VerifierFactory = makeScriptedVerdictFactory((ctx) => ({ intent_path: ctx.intentPath, decision: "accept", per_triple: [], aggregate_rationale: "ok" }));

let mg: MockGitWorktree;
beforeEach(() => {
  clearSnapshot("p5t12");
  mg = createMockGitWorktree({ idBase: "20260611150000" });
  mkdirSync(join(mg.repoDir, ".claude/agents"), { recursive: true });
  for (const [slug, memory] of [["engineer", "bead"], ["verifier", "none"], ["bead", "bead"], ["test-runner", "bead"]] as const) {
    writeFileSync(join(mg.repoDir, ".claude/agents", `dusk-${slug}.md`), role(slug, memory));
  }
});
afterEach(() => {
  clearSnapshot("p5t12");
  mg.cleanup();
});

describe("P5-T12 — an unreachable OTLP sink does not block or fail the run", () => {
  test("the pipeline finishes normally, traces.jsonl is complete, and the sink failure is visible only out-of-band", async () => {
    const sinkErrors: unknown[] = [];
    const unreachable = otlpSink("http://127.0.0.1:1/v1/logs", {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:1");
      },
    });
    const forwarder = startForwarder(mg.repoDir, unreachable, { intervalMs: 5, onError: (e) => sinkErrors.push(e) });

    const deps: RunImplementDeps = {
      rootDir: mg.repoDir,
      sessionId: "p5t12",
      env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }),
      taskRunner: async () => ({ output: "ok", model: "claude-sonnet-4-6", promptTokens: 1, completionTokens: 1, costUsd: 0, latencyMs: 1 }),
      verifierFactory: accept,
      buildIndex,
      clock: fixedClock(1_000),
      config: DuskConfigSchema.parse({ observability: { mirrors: [{ sink: "otlp", endpoint: "http://127.0.0.1:1/v1/logs" }] } }),
      perEntryMax: 20,
      lifetimeMax: 40,
      vitestRunner: (files) => makeVitestJsonReportString(files.map((f) => ({ file: f, title: "t", status: "passed" as const, duration: 1 }))),
    };

    const result = await runImplement({ request: "add the api/widget shape", scopeHint: ["api/widget"] }, deps);
    forwarder.stop();

    // The pipeline result is clean — no sink-related error anywhere in it.
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.commits.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.value)).not.toMatch(/ECONNREFUSED|otlp|sink/i);

    // traces.jsonl is the source of truth and is complete.
    const traces = readTraces(mg.repoDir);
    expect(traces.length).toBeGreaterThan(0);

    // The unreachable sink's failure is visible ONLY in the forwarder's own
    // out-of-band channel; the failed batch was never marked delivered.
    await expect(runForwarderOnce(mg.repoDir, unreachable)).rejects.toThrow("ECONNREFUSED");
  });
});
