import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";
import type { Intent } from "@dusk/core-schema";
import { createMockGitWorktree, createTempRepo, fixedClock, readTraces, type MockGitWorktree, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createBeadDelta, crossBeadView, sameBeadView } from "./beadDelta.js";
import { readRuntimeEnv } from "./env.js";
import { snapshotIndex, startActiveRun, endActiveRun } from "./activeRun.js";
import { buildSessionSnapshot, clearSnapshot, getOrBuildSnapshot } from "./snapshot.js";
import { spawnSubAgent, type SpawnDeps } from "./spawn.js";

// §2 session-snapshot-index — zero-model + real git.

const intent = (id: string): Intent => ({
  schema_version: 2,
  id,
  description: `intent ${id}`,
  obligation: "must",
  compose: "all",
  triples: [{ id: "t1", subject: "s", predicate: "p", object: "o", polarity: "positive" }],
  relates_to: [],
});

const record = (file: string, intentPath: string): DecorationRecord => ({
  file,
  line: 1,
  scope: "declaration",
  declaration_name: "x",
  marker: "intent",
  intent_path: intentPath,
  aspect_ids: ["t1"],
  support_triple: null,
  ignore_clause: null,
});

const intentsMap = new Map<string, Intent>([["api/x", intent("api/x")]]);
const buildBaseIndex = () => buildDerivedIndex([record("src/base.ts", "api/x")], intentsMap);

const roleFile = (slug: string, memory: string, body: string): string =>
  ["---", "dusk_role_version: 2", `name: dusk-${slug}`, "description: test", "tools: [Read]", `memory: ${memory}`, "skills: []", "model: claude-sonnet-4-6", "---", "", body, ""].join("\n");

describe("Phase 6 §1.3 — default base ref falls back for a standalone repo with no remote", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = createTempRepo({ git: false });
  });
  afterEach(() => repo.cleanup());

  test("buildSessionSnapshot resolves the merge-base via a fallback when origin/main is absent", () => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo.dir, encoding: "utf8" });
    git("init");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "T");
    writeFileSync(join(repo.dir, "f.txt"), "x");
    git("add", "-A");
    git("commit", "-m", "init");
    // A fresh standalone repo has no `origin/main` remote-tracking ref; the
    // default base ref must fall back (main → HEAD) instead of crashing.
    const snapshot = buildSessionSnapshot({ repoDir: repo.dir, buildIndex: buildBaseIndex });
    expect(snapshot.mergeBaseCommit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(["origin/main", "main", "HEAD"]).toContain(snapshot.baseRef);
  });
});

describe("2.1 — snapshot id stamped on every trace; --rebuild-index produces a new id", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = createTempRepo({ git: false });
    repo.write(".claude/agents/dusk-engineer.md", roleFile("engineer", "bead", "# E"));
    repo.write(".claude/agents/dusk-bead.md", roleFile("bead", "bead", "# B"));
  });
  afterEach(() => repo.cleanup());

  test("a multi-spawn run emits N traces all sharing one index_snapshot_id", async () => {
    const snapshot = buildSessionSnapshot({ repoDir: repo.dir, buildIndex: buildBaseIndex, resolveCommit: () => "deadbeefcommit" });
    const deps: SpawnDeps = {
      rootDir: repo.dir,
      env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }),
      clock: fixedClock(1_000),
      taskRunner: async () => ({ output: "ok", model: "claude-sonnet-4-6", promptTokens: 1, completionTokens: 1, costUsd: 0, latencyMs: 1 }),
      indexSnapshotId: snapshot.id,
    };
    for (let i = 0; i < 3; i++) await spawnSubAgent({ role: "engineer", beadId: "bd_1", sessionId: "s1", input: `iter ${i}` }, deps);
    await spawnSubAgent({ role: "bead-orchestrator", beadId: "bd_1", sessionId: "s1", input: "route" }, deps);

    const traces = readTraces(repo.dir);
    expect(traces).toHaveLength(4);
    const ids = new Set(traces.map((t) => t.index_snapshot_id));
    expect(ids.size).toBe(1);
    expect(ids.has(snapshot.id)).toBe(true);
    expect(snapshot.id).toMatch(/^[0-9a-f]{64}$/);
  });

  test("--rebuild-index after origin/main advances produces a different id", () => {
    const mg: MockGitWorktree = createMockGitWorktree();
    try {
      clearSnapshot("sess-rebuild");
      const first = getOrBuildSnapshot("sess-rebuild", { repoDir: mg.repoDir, buildIndex: buildBaseIndex });
      // A normal re-invocation in the same session reuses the frozen snapshot.
      const reused = getOrBuildSnapshot("sess-rebuild", { repoDir: mg.repoDir, buildIndex: buildBaseIndex });
      expect(reused.id).toBe(first.id);

      // origin/main advances (Q2: the snapshot is now stale).
      writeFileSync(join(mg.repoDir, "advance.txt"), "more\n");
      execFileSync("git", ["add", "-A"], { cwd: mg.repoDir });
      execFileSync("git", ["commit", "-q", "-m", "feat: advance main"], { cwd: mg.repoDir });
      execFileSync("git", ["push", "-q", "origin", "main"], { cwd: mg.repoDir });

      const rebuilt = getOrBuildSnapshot("sess-rebuild", { repoDir: mg.repoDir, buildIndex: buildBaseIndex }, { rebuildIndex: true });
      expect(rebuilt.id).not.toBe(first.id);
      expect(rebuilt.mergeBaseCommit).not.toBe(first.mergeBaseCommit);
    } finally {
      clearSnapshot("sess-rebuild");
      mg.cleanup();
    }
  });
});

describe("2.2 — cross-bead queries see the snapshot only; same-bead sees snapshot ∪ delta (P3-T1)", () => {
  test("bead A's write is visible to A's own view, invisible to a cross-bead view", () => {
    const snapshot = buildSessionSnapshot({ repoDir: "/unused", buildIndex: buildBaseIndex, resolveCommit: () => "c0" });
    const deltaA = createBeadDelta("bd_A");
    deltaA.add(record("src/a-only.ts", "api/x"));

    // A's own Verifier/Test-Runner scope query: snapshot ∪ delta.
    const aView = sameBeadView(snapshot, deltaA);
    expect(aView.reverse("src/a-only.ts")).toEqual(["api/x"]);
    expect(aView.forward("api/x").map((r) => r.file)).toContain("src/a-only.ts");

    // Bead B's cross-bead queries (file-overlap, long-cycle universe, overlap precondition): snapshot only.
    const crossView = crossBeadView(snapshot);
    expect(crossView.reverse("src/a-only.ts")).toEqual([]);
    expect(crossView.forward("api/x").map((r) => r.file)).not.toContain("src/a-only.ts");

    // Same Phase-1 D6 query interface on both views.
    expect(typeof aView.focalSupport).toBe("function");
    expect(typeof crossView.focalSupport).toBe("function");
  });
});

describe("2.3 — read-path reads against the snapshot, not bead deltas", () => {
  test("snapshotIndex(activeRun) excludes the bead's in-flight delta and preserves Phase-1 signatures", () => {
    const snapshot = buildSessionSnapshot({ repoDir: "/unused", buildIndex: buildBaseIndex, resolveCommit: () => "c0" });
    const run = startActiveRun("s-read", snapshot);
    try {
      const delta = createBeadDelta("bd_1");
      delta.add(record("src/in-flight.ts", "api/x"));
      run.deltas.set("bd_1", delta);

      const readIndex = snapshotIndex(run);
      // The bead's in-flight decoration is NOT visible to the read path.
      expect(readIndex.reverse("src/in-flight.ts")).toEqual([]);
      // Snapshot state IS visible, via the unchanged Phase-1 query surface.
      expect(readIndex.reverse("src/base.ts")).toEqual(["api/x"]);
      expect(readIndex.forward("api/x").map((r) => r.file)).toEqual(["src/base.ts"]);
      expect(readIndex.focalSupport("api/x", "t1").focal).toHaveLength(1);
    } finally {
      endActiveRun();
    }
  });
});
