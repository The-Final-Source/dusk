import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";
import { DuskConfigSchema, duskError, type Intent, type VerifierFactory } from "@dusk/core-schema";
import {
  createMockGitWorktree,
  fixedClock,
  makeScriptedVerdictFactory,
  makeDuskTestCapture,
  readTraces,
  type MockGitWorktree,
} from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { readRuntimeEnv } from "./env.js";
import { clearSnapshot } from "./snapshot.js";
import { runImplement, type RunImplementDeps } from "./stateMachine.js";

// §13.1 — dusk_implement 9-step pipeline e2e (zero-model via the scripted double).

const roleFile = (slug: string, memory: string, body: string): string =>
  ["---", "dusk_role_version: 2", `name: dusk-${slug}`, "description: test", "tools: [Read, Edit]", `memory: ${memory}`, "skills: []", "model: claude-sonnet-4-6", "---", "", body, ""].join("\n");

const implIntent: Intent = {
  schema_version: 2,
  id: "api/widget",
  description: "widget shape",
  obligation: "must",
  compose: "all",
  triples: [{ id: "shape", subject: "the widget", predicate: "has", object: "a typed shape", polarity: "positive" }],
  relates_to: [],
};
const testIntent: Intent = {
  schema_version: 2,
  id: "api/widget/unit-tests",
  description: "widget unit tests",
  obligation: "must",
  compose: "all",
  triples: [{ id: "covers-shape", subject: "the test", predicate: "verifies", object: "the widget shape", polarity: "positive" }],
  relates_to: [],
};

const rec = (file: string, marker: DecorationRecord["marker"], intentPath: string, aspects: string[]): DecorationRecord => ({
  file,
  line: 1,
  scope: marker.includes("file") ? "file" : "declaration",
  declaration_name: marker.includes("file") ? null : "widget",
  marker,
  intent_path: intentPath,
  aspect_ids: aspects,
  support_triple: null,
  ignore_clause: null,
});

function buildIndex(): DerivedIndex {
  return buildDerivedIndex(
    [rec("src/widget.ts", "intent", "api/widget", ["shape"]), rec("src/widget.unit.test.ts", "intent-test", "api/widget/unit-tests", ["covers-shape"])],
    new Map([
      ["api/widget", implIntent],
      ["api/widget/unit-tests", testIntent],
    ]),
  );
}

const acceptFactory: VerifierFactory = makeScriptedVerdictFactory((ctx) => ({ intent_path: ctx.intentPath, decision: "accept", per_triple: [], aggregate_rationale: "ok" }));

let mg: MockGitWorktree;
beforeEach(() => {
  clearSnapshot("e2e");
  mg = createMockGitWorktree();
  mkdirSync(join(mg.repoDir, ".claude/agents"), { recursive: true });
  for (const [slug, memory] of [["engineer", "bead"], ["verifier", "none"], ["bead", "bead"], ["test-runner", "bead"]] as const) {
    writeFileSync(join(mg.repoDir, ".claude/agents", `dusk-${slug}.md`), roleFile(slug, memory, `# ${slug}`));
  }
});
afterEach(() => {
  clearSnapshot("e2e");
  mg.cleanup();
});

function deps(): RunImplementDeps {
  return {
    rootDir: mg.repoDir,
    sessionId: "e2e",
    env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }),
    taskRunner: async () => ({ output: "drafted", model: "claude-sonnet-4-6", promptTokens: 5, completionTokens: 2, costUsd: 0.001, latencyMs: 3 }),
    verifierFactory: acceptFactory,
    buildIndex,
    clock: fixedClock(1_000),
    config: DuskConfigSchema.parse({}),
    perEntryMax: 20,
    lifetimeMax: 40,
    vitestRunner: (files) => makeDuskTestCapture(files.map((f) => ({ file: f, title: "shape test", status: "passed" as const, duration: 2 }))),
  };
}

describe("13.1 — fresh request walks the full pipeline", () => {
  test("converges, lands one commit per bead on main, returns a complete Step-9 summary", async () => {
    const result = await runImplement({ request: "add the api/widget shape", scopeHint: ["api/widget"] }, deps());
    expect(result.success).toBe(true);
    if (!result.success) return;
    const summary = result.value;
    // One commit per bead (impl + auto-added unit-tests child).
    expect(summary.commits.length).toBe(2);
    for (const c of summary.commits) expect(c.commit_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(summary.intents_touched).toContain("api/widget");
    expect(summary.intents_touched).toContain("api/widget/unit-tests");
    expect(summary.test_intents_executed).toContain("api/widget/unit-tests");
    expect(typeof summary.total_duration_ms).toBe("number");

    // index_snapshot_id invariant: every trace shares the one id.
    const traces = readTraces(mg.repoDir);
    expect(traces.length).toBeGreaterThan(0);
    const ids = new Set(traces.map((t) => t.index_snapshot_id));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[0-9a-f]{64}$/);

    // The work landed on main (worktrees removed by Step 8).
    expect(mg.worktreePaths()).toHaveLength(0);
  });
});

// RFC App. D.34 — both honesty duals, model-independently (zero-model, scripted).
describe("App. D.34 — both honesty duals hold model-independently", () => {
  // A Verifier factory that always returns a degraded/empty boundary (no throw —
  // the live shape: returns-without-throwing).
  const noVerdictFactory: VerifierFactory = async () =>
    duskError("infrastructure_no_verdict", "degraded/empty verifier under load", { recoverable: true, details: { no_verdict_reason: "empty" } });

  test("Dual A — a sustained empty/degraded Verifier pauses on the finite infrastructure axis (never a futile loop, never a crash, resumable)", async () => {
    const result = await runImplement(
      { request: "add the api/widget shape", scopeHint: ["api/widget"] },
      { ...deps(), verifierFactory: noVerdictFactory, noVerdictMax: 2 },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.kind).toBe("infrastructure_no_verdict"); // the recovery axis — NOT a content reject
    expect(result.error.recoverable).toBe(true); // a pause, not a terminal failure
    expect(result.error.recovery_hint ?? "").toContain("resume"); // R7a: legible, resumable
    // No bead committed (the loop did not silent-green); worktrees still present (not merged).
    expect(mg.worktreePaths().length).toBeGreaterThan(0);
  });

  // Dual B (a Stage-2 `decision:"fail"` re-enters Step 4 and blocks commit — the
  // silent green) is covered deterministically at the Test Runner boundary in
  // `@dusk/runtime-test-runner` (`run.ts`: a failing Dusk-schema result → a
  // `reenter_step4` outcome, never a `verdict`), which the orchestrator routes
  // through the already-tested livelock-observation block.
});

describe("13.1 — exactly one of request / resume_token", () => {
  test("neither → config_invalid", async () => {
    const r = await runImplement({}, deps());
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.kind).toBe("config_invalid");
  });
  test("both → config_invalid", async () => {
    const r = await runImplement({ request: "x", resumeToken: "rt_20260610000000001" }, deps());
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.kind).toBe("config_invalid");
  });
});
