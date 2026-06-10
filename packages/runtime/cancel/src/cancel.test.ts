import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CancelResultSchema } from "@dusk/core-schema";
import { createMockGitWorktree, type MockGitWorktree } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { runCancel, type CleanupStep } from "./cancel.js";
import { clearCancelFlags, isCancelled, setCancelFlag } from "./flag.js";

// §12 cooperative-cancel — zero-model + real git/fs.

const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function commitInWorktree(path: string, name: string): void {
  writeFileSync(join(path, `${name}.ts`), `export const ${name} = 1;\n`);
  git(path, ["add", "-A"]);
  git(path, ["commit", "-q", "-m", `feat: ${name}`]);
}

let mg: MockGitWorktree;
beforeEach(() => {
  clearCancelFlags();
  mg = createMockGitWorktree();
});
afterEach(() => {
  mg.cleanup();
  clearCancelFlags();
});

describe("12.1 — cooperative flag (no Task abort)", () => {
  test("a per-bead flag marks the bead cancelled; a session flag marks all", () => {
    setCancelFlag("user abort", "bd_1");
    expect(isCancelled("bd_1")).toBe(true);
    expect(isCancelled("bd_2")).toBe(false);
    clearCancelFlags();
    setCancelFlag("session abort");
    expect(isCancelled("bd_anything")).toBe(true);
  });

  test("runCancel reports the drained in-flight count verbatim", () => {
    const { result } = runCancel({ rootDir: mg.repoDir, reason: "x", targets: { beadIds: [] }, inFlightTasksDrained: 2, traceId: "tr_1", drainDurationMs: 5 });
    expect(result.preserved.in_flight_tasks_drained).toBe(2);
  });
});

describe("12.2 — ordered cleanup: dialogs → checkpoints → bead memory → worktrees", () => {
  test("cleanup steps fire in the fixed order", () => {
    const handle = mg.createWorktree(); // empty worktree (no commits) → reaped
    // Seed a dialog, checkpoint, and bead memory.
    mkdirSync(join(mg.repoDir, ".ia/runtime/dialogs/dlg_1"), { recursive: true });
    mkdirSync(join(mg.repoDir, ".ia/runtime/implement"), { recursive: true });
    writeFileSync(join(mg.repoDir, ".ia/runtime/implement/rt_1.json"), "{}");
    mkdirSync(join(mg.repoDir, ".ia/runtime/beads", handle.beadId), { recursive: true });
    writeFileSync(join(mg.repoDir, ".ia/runtime/beads", handle.beadId, "engineer.md"), "x");

    const steps: CleanupStep[] = [];
    runCancel({
      rootDir: mg.repoDir,
      reason: "x",
      targets: { beadIds: [handle.beadId], dialogIds: ["dlg_1"], checkpointTokens: ["rt_1"] },
      inFlightTasksDrained: 0,
      traceId: "tr_1",
      drainDurationMs: 0,
      onCleanupStep: (e) => steps.push(e),
    });
    expect(steps.map((s) => s.step)).toEqual(["dialog", "checkpoint", "bead_memory", "worktree"]);
    expect(existsSync(join(mg.repoDir, ".ia/runtime/dialogs/dlg_1"))).toBe(false);
    expect(existsSync(join(mg.repoDir, ".ia/runtime/implement/rt_1.json"))).toBe(false);
  });
});

describe("12.3 — worktrees with commits are preserved as partial_commits[]", () => {
  test("a branch with an unmerged commit is NOT deleted; appears in partial_commits", () => {
    const handle = mg.createWorktree();
    commitInWorktree(handle.path, "feature");
    const { result } = runCancel({ rootDir: mg.repoDir, reason: "x", targets: { beadIds: [handle.beadId] }, inFlightTasksDrained: 0, traceId: "tr_1", drainDurationMs: 0 });
    expect(result.cancelled.partial_commits).toHaveLength(1);
    expect(result.cancelled.partial_commits[0]).toMatchObject({ bead_id: handle.beadId, branch: handle.branch });
    expect(mg.listDuskBranches()).toContain(handle.branch); // NOT deleted
    expect(mg.worktreePaths().some((p) => p.endsWith(handle.beadId))).toBe(true); // NOT removed
  });
});

describe("12.4 — already-merged work is informational, not undone (P3-T22)", () => {
  test("cancel on a fully-merged bead returns cancellation_already_committed + preserved", () => {
    const handle = mg.createWorktree();
    commitInWorktree(handle.path, "merged-feature");
    const sha = git(handle.path, ["rev-parse", "HEAD"]);
    // Land it on main (Step 8 already completed for this bead).
    git(mg.repoDir, ["merge", "--no-edit", handle.branch]);

    const { result, informational } = runCancel({
      rootDir: mg.repoDir,
      reason: "x",
      targets: { beadIds: [handle.beadId], mergedBeads: [{ bead_id: handle.beadId, commit_sha: sha }] },
      inFlightTasksDrained: 0,
      traceId: "tr_1",
      drainDurationMs: 0,
    });
    expect(informational?.kind).toBe("cancellation_already_committed");
    expect(informational?.recoverable).toBe(false);
    expect(result.preserved.already_committed).toEqual([{ bead_id: handle.beadId, commit_sha: sha }]);
    // Commit still on main (not reverted).
    expect(git(mg.repoDir, ["log", "--format=%s"])).toContain("feat: merged-feature");
  });
});

describe("12.5 — mixed-state partitioning + frozen schema (P3-T22)", () => {
  test("A merged, B worktree-commit, C empty → correct cancelled/preserved partition", () => {
    const a = mg.createWorktree();
    commitInWorktree(a.path, "a-merged");
    const aSha = git(a.path, ["rev-parse", "HEAD"]);
    git(mg.repoDir, ["merge", "--no-edit", a.branch]);

    const b = mg.createWorktree();
    commitInWorktree(b.path, "b-unmerged");

    const c = mg.createWorktree(); // empty

    const { result } = runCancel({
      rootDir: mg.repoDir,
      reason: "x",
      targets: { beadIds: [a.beadId, b.beadId, c.beadId], mergedBeads: [{ bead_id: a.beadId, commit_sha: aSha }] },
      inFlightTasksDrained: 1,
      traceId: "tr_1",
      drainDurationMs: 7,
    });

    expect(result.preserved.already_committed.map((e) => e.bead_id)).toEqual([a.beadId]);
    expect(result.cancelled.partial_commits.map((e) => e.bead_id)).toEqual([b.beadId]);
    expect(result.cancelled.cancelled_worktrees).toEqual([c.branch]);
    expect(Number.isInteger(result.preserved.in_flight_tasks_drained)).toBe(true);
    expect(CancelResultSchema.safeParse(result).success).toBe(true);
  });
});
