import { execFileSync } from "node:child_process";
import { mkdirSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DAY_MS, HOUR_MS, createMockGitWorktree, mockClock, type MockGitWorktree } from "@dusk/test-harness";
import { newResumeToken, writeCheckpoint } from "@dusk/runtime-implement-checkpoint";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { cleanupWorktreesCommand, gcCheckpointsCommand, gcDialogsCommand } from "./doctorP3.js";
import { runImplementCli } from "./implement.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

const run = (args: string[], cwd: string): { code: number; out: string } => {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: err.stdout ?? "" };
  }
};

describe("4.2 — dusk doctor --cleanup-worktrees reaps orphans, idempotent", () => {
  let mg: MockGitWorktree;
  beforeEach(() => {
    mg = createMockGitWorktree();
  });
  afterEach(() => mg.cleanup());

  test("reaps an orphan worktree; second run is a no-op", () => {
    mg.createWorktree();
    expect(mg.worktreePaths()).toHaveLength(1);
    const first = cleanupWorktreesCommand(mg.repoDir);
    expect(first.exitCode).toBe(0);
    expect(first.text).toContain("reaped worktree");
    expect(mg.worktreePaths()).toHaveLength(0);
    const second = cleanupWorktreesCommand(mg.repoDir);
    expect(second.text).toBe("");
    expect(second.exitCode).toBe(0);
  });
});

describe("3.4 — dusk doctor --gc-implement-checkpoints reaps stale, preserves fresh", () => {
  let mg: MockGitWorktree;
  beforeEach(() => {
    mg = createMockGitWorktree();
  });
  afterEach(() => mg.cleanup());

  test("only the >24h checkpoint is reaped", () => {
    const now = Date.parse("2026-06-11T00:00:00.000Z");
    const clock = mockClock(now);
    const cp = (touchedMs: number) => ({ schema_version: 1 as const, original_request: "r", decomposer_partial_state: { active_intents: [], edges: [] }, intents_resolved_so_far: [], intents_still_unresolved: ["x"], suggested_dialog_seed: "enriched seed for x", unresolved_refs: ["x"], created_at: new Date(touchedMs).toISOString(), last_touched_at: new Date(touchedMs).toISOString() });
    const stale = newResumeToken(mockClock(now - 30 * HOUR_MS), 1);
    const fresh = newResumeToken(mockClock(now - HOUR_MS), 2);
    writeCheckpoint(mg.repoDir, stale, cp(now - 30 * HOUR_MS));
    writeCheckpoint(mg.repoDir, fresh, cp(now - HOUR_MS));
    const result = gcCheckpointsCommand(mg.repoDir, clock);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain(stale);
    expect(result.text).not.toContain(fresh);
  });
});

describe("14.6 — dusk doctor --gc-dialogs reaps stale dialogs", () => {
  let mg: MockGitWorktree;
  beforeEach(() => {
    mg = createMockGitWorktree();
  });
  afterEach(() => mg.cleanup());

  test("a >24h dialog dir is reaped; a fresh one is preserved", () => {
    const now = Date.now();
    const stale = join(mg.repoDir, ".ia/runtime/dialogs/dlg_stale");
    const fresh = join(mg.repoDir, ".ia/runtime/dialogs/dlg_fresh");
    mkdirSync(stale, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    const staleSec = (now - 30 * HOUR_MS) / 1000;
    utimesSync(stale, staleSec, staleSec);
    const result = gcDialogsCommand(mg.repoDir, { now: () => now });
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain("dlg_stale");
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

describe("14.4/14.5 — dusk implement usage + 14.7 --help", () => {
  let mg: MockGitWorktree;
  beforeEach(() => {
    mg = createMockGitWorktree();
  });
  afterEach(() => mg.cleanup());

  test("dusk implement with no request prints usage and exits 1", async () => {
    const result = await runImplementCli(mg.repoDir, []);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("usage: dusk implement");
  });

  test("--help on each new command exits 0 with a usage substring", () => {
    void DAY_MS;
    for (const args of [["implement", "--help"], ["doctor", "--help"]]) {
      const r = run(args, mg.repoDir);
      expect(r.code).toBe(0);
      expect(r.out.length).toBeGreaterThan(0);
    }
    expect(run(["implement", "--help"], mg.repoDir).out).toContain("dusk implement");
    expect(run(["doctor", "--help"], mg.repoDir).out).toContain("--cleanup-worktrees");
  });
});
