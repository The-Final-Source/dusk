import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";
import { DuskConfigSchema, type CommitTrailers, type Intent, type VerifierFactory } from "@dusk/core-schema";
import { decompose } from "@dusk/runtime-decomposer";
import { runRecoveryLadder } from "@dusk/runtime-recovery-ladder";
import { runCancel } from "@dusk/runtime-cancel";
import { execFileSync } from "node:child_process";
import {
  createMockGitWorktree,
  fixedClock,
  makeScriptedVerdictFactory,
  makeVitestJsonReportString,
  readTraces,
  tracesForRole,
  type MockGitWorktree,
} from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { readRuntimeEnv } from "./env.js";
import { clearSnapshot } from "./snapshot.js";
import { runImplement, type RunImplementDeps } from "./stateMachine.js";

// §15.3 — Phase-3 phase-landing smoke test (four scenarios). The Primary path's
// real-frontier-model leg is gated to the correctness suite; here the control
// machinery is proven zero-model via the scripted-verdict double + real git.

const role = (slug: string, memory: string): string =>
  ["---", "dusk_role_version: 2", `name: dusk-${slug}`, "description: t", "tools: [Read, Edit]", `memory: ${memory}`, "skills: []", "model: claude-sonnet-4-6", "---", "", `# ${slug}`, ""].join("\n");

const mkIntent = (id: string, triple: string): Intent => ({ schema_version: 2, id, description: id, obligation: "must", compose: "all", triples: [{ id: triple, subject: "s", predicate: "p", object: "o", polarity: "positive" }], relates_to: [] });
const focal = (file: string, line: number, intentPath: string, decl: string, aspects: string[]): DecorationRecord => ({ file, line, scope: "declaration", declaration_name: decl, marker: "intent", intent_path: intentPath, aspect_ids: aspects, support_triple: null, ignore_clause: null });

const accept: VerifierFactory = makeScriptedVerdictFactory((ctx) => ({ intent_path: ctx.intentPath, decision: "accept", per_triple: [], aggregate_rationale: "ok" }));

let mg: MockGitWorktree;
let seq = 0;
beforeEach(() => {
  clearSnapshot("smoke");
  clearSnapshot("smoke-resume");
  mg = createMockGitWorktree({ idBase: `2026061013000${seq++}` });
  mkdirSync(join(mg.repoDir, ".claude/agents"), { recursive: true });
  for (const [slug, memory] of [["engineer", "bead"], ["verifier", "none"], ["bead", "bead"], ["test-runner", "bead"]] as const) {
    writeFileSync(join(mg.repoDir, ".claude/agents", `dusk-${slug}.md`), role(slug, memory));
  }
});
afterEach(() => {
  clearSnapshot("smoke");
  clearSnapshot("smoke-resume");
  mg.cleanup();
});

// A cross-cutting observability intent + an impl intent that file-overlap it.
function fileOverlapIndex(): DerivedIndex {
  return buildDerivedIndex(
    [focal("src/widget.ts", 3, "observability/log", "log", ["emit"]), focal("src/widget.ts", 20, "api/widget", "widget", ["shape"])],
    new Map([["observability/log", mkIntent("observability/log", "emit")], ["api/widget", mkIntent("api/widget", "shape")]]),
  );
}

const deps = (sessionId: string, buildIndex: () => DerivedIndex, over: Partial<RunImplementDeps> = {}): RunImplementDeps => ({
  rootDir: mg.repoDir,
  sessionId,
  env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }),
  taskRunner: async () => ({ output: "ok", model: "claude-sonnet-4-6", promptTokens: 1, completionTokens: 1, costUsd: 0, latencyMs: 1 }),
  verifierFactory: accept,
  buildIndex,
  clock: fixedClock(1_000),
  config: DuskConfigSchema.parse({}),
  perEntryMax: 20,
  lifetimeMax: 40,
  vitestRunner: (files) => makeVitestJsonReportString(files.map((f) => ({ file: f, title: "t", status: "passed" as const, duration: 1 }))),
  ...over,
});

describe("Primary — file-overlap DAG → converge → N=10 clean → 1 commit per bead → invariants", () => {
  test("decompose issues a file-overlap serialization edge", () => {
    const r = decompose({ index: fileOverlapIndex(), clock: fixedClock(1_000), rootDir: mg.repoDir, request: "x", scopeHint: ["observability/log", "api/widget"] });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.dag.edges.some((e) => e.source === "file-overlap")).toBe(true);
  });

  test("runImplement lands one commit per bead; every trace shares one index_snapshot_id; no iter-specific Verifier prompt", async () => {
    const result = await runImplement({ request: "x", scopeHint: ["observability/log", "api/widget"] }, deps("smoke", fileOverlapIndex));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.commits.length).toBe(2); // one per bead

    const traces = readTraces(mg.repoDir);
    const ids = new Set(traces.map((t) => t.index_snapshot_id));
    expect(ids.size).toBe(1);
    // Asymmetry: no Verifier raw_prompt carries an iteration counter.
    for (const v of tracesForRole(traces, "verifier")) expect(v.raw_prompt ?? "").not.toMatch(/iter(ation)?[ _-]?\d/i);
  });
});

describe("Variant A — pause/resume", () => {
  test("unauthored intent pauses; resume with the authored intent completes; checkpoint consumed", async () => {
    const paused = await runImplement({ request: "add api/unauthored", scopeHint: ["api/unauthored"] }, deps("smoke", () => buildDerivedIndex([], new Map())));
    expect(paused.success).toBe(false);
    if (paused.success) return;
    expect(paused.error.kind).toBe("implement_paused_for_authoring");
    const token = paused.error.details?.resume_token as string;
    expect(mg.repoDir && token).toBeTruthy();

    // Author the intent out-of-band, then resume (fresh session picks up the new index).
    const authored = (): DerivedIndex => buildDerivedIndex([], new Map([["api/unauthored", mkIntent("api/unauthored", "shape")]]));
    const resumed = await runImplement({ resumeToken: token }, deps("smoke-resume", authored));
    expect(resumed.success).toBe(true);
    if (!resumed.success) return;
    // Checkpoint consumed (single-use): a second resume is expired.
    const again = await runImplement({ resumeToken: token }, deps("smoke-resume", authored, { rebuildIndex: true }));
    expect(again.success).toBe(false);
    if (again.success) return;
    expect(again.error.kind).toBe("implement_resume_token_expired");
  });
});

describe("Variant B — recovery ladder L1 (partial) + L2 (revision needed)", () => {
  const trailers = (beadId: string): CommitTrailers => ({ intents: [{ intent_path: "api/a", aspect_ids: ["t1"] }, { intent_path: "api/b", aspect_ids: ["t1"] }], test_intents: [], bead_id: beadId, verdict_id: "vd", trace_id: "tr", verifier_model: "m", long_cycle_samples: 10, test_suites_passed: 0 });

  test("L1 partial commit lands (one satisfiable); L2 emits a recoverable revision proposal (zero satisfiable)", () => {
    const h = mg.createWorktree();
    writeFileSync(join(h.path, "a.ts"), "export const a = 1;\n");
    const l1 = runRecoveryLadder({ rootDir: h.path, beadId: h.beadId, worktreePath: h.path, satisfiedIntents: ["api/a"], deferredIntents: ["api/b"], diagnosisHistory: [], lastVerdicts: [], beadMemory: "", trailers: trailers(h.beadId), subject: "feat: api/a only" });
    expect(l1.success && l1.value.level).toBe("L1");

    const l2BeadId = mg.nextBeadId();
    const l2 = runRecoveryLadder({ rootDir: mg.repoDir, beadId: l2BeadId, worktreePath: mg.repoDir, satisfiedIntents: [], deferredIntents: ["api/a", "api/b"], diagnosisHistory: [{ iter: 3, text: "unsatisfiable" }], lastVerdicts: [], beadMemory: "", trailers: trailers(l2BeadId), subject: "x" });
    expect(l2.success).toBe(true);
    if (!l2.success || l2.value.level !== "L2") return;
    expect(l2.value.error.kind).toBe("bead_intent_revision_needed");
    expect(l2.value.error.recoverable).toBe(true);
  });
});

describe("Variant C — cooperative cancel partitioning", () => {
  test("merged + worktree-commit + empty → correct cancelled/preserved partition", () => {
    const a = mg.createWorktree();
    writeFileSync(join(a.path, "a.ts"), "export const a=1;\n");
    execFileSync("git", ["add", "-A"], { cwd: a.path });
    execFileSync("git", ["commit", "-q", "-m", "feat: a"], { cwd: a.path });
    const aSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: a.path, encoding: "utf8" }).trim();
    execFileSync("git", ["merge", "--no-edit", a.branch], { cwd: mg.repoDir });

    const b = mg.createWorktree();
    writeFileSync(join(b.path, "b.ts"), "export const b=1;\n");
    execFileSync("git", ["add", "-A"], { cwd: b.path });
    execFileSync("git", ["commit", "-q", "-m", "feat: b"], { cwd: b.path });

    const c = mg.createWorktree();

    const { result } = runCancel({ rootDir: mg.repoDir, reason: "user abort", targets: { beadIds: [a.beadId, b.beadId, c.beadId], mergedBeads: [{ bead_id: a.beadId, commit_sha: aSha }] }, inFlightTasksDrained: 1, traceId: "tr", drainDurationMs: 4 });
    expect(result.preserved.already_committed.map((e) => e.bead_id)).toEqual([a.beadId]);
    expect(result.cancelled.partial_commits.map((e) => e.bead_id)).toEqual([b.beadId]);
    expect(result.cancelled.cancelled_worktrees).toEqual([c.branch]);
  });
});
