import type { BeadDag } from "@dusk/core-schema";
import { createMockGitWorktree, type MockGitWorktree } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { cleanupOrphanWorktrees } from "./cleanup.js";
import { planWorktrees } from "./plan.js";
import { addWorktree, branchName, createWorktreesForDag, newBeadId } from "./worktree.js";

let mg: MockGitWorktree;
beforeEach(() => {
  mg = createMockGitWorktree({ files: { "src/a.ts": "export const a = 1;\n" } });
});
afterEach(() => mg.cleanup());

const node = (bead_id: string, files: string[]): BeadDag["nodes"][number] => ({ bead_id, intent_paths: [], predicted_files: files });

describe("4.1 — bead-id format + parallel/serial worktree decision (P3-T23)", () => {
  test("two independent beads → two worktrees off origin/main; branches match the regex", () => {
    const a = mg.nextBeadId();
    const b = mg.nextBeadId();
    const dag: BeadDag = { nodes: [node(a, ["src/a.ts"]), node(b, ["src/b.ts"])], edges: [] };

    expect(planWorktrees(dag)).toHaveLength(2);
    const result = createWorktreesForDag(mg.repoDir, dag, { baseRef: "origin/main" });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.value.handles).toHaveLength(2);
    expect(mg.worktreePaths()).toHaveLength(2);
    for (const branch of [branchName(a), branchName(b)]) {
      expect(branch).toMatch(/^dusk\/bd_[0-9]{14}[0-9]{3}$/);
      expect(mg.listDuskBranches()).toContain(branch);
    }
  });

  test("file-overlap-linked pair runs serially in one worktree (no second worktree add)", () => {
    const a = mg.nextBeadId();
    const b = mg.nextBeadId();
    const dag: BeadDag = {
      nodes: [node(a, ["src/shared.ts"]), node(b, ["src/shared.ts"])],
      edges: [{ from: b, to: a, source: "file-overlap" }],
    };

    const groups = planWorktrees(dag);
    expect(groups).toHaveLength(1);
    expect(groups[0].beads).toEqual([a, b]); // a before b (topological)

    const result = createWorktreesForDag(mg.repoDir, dag, { baseRef: "origin/main" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.handles).toHaveLength(1); // only the group's first bead got a worktree
    expect(mg.worktreePaths()).toHaveLength(1);
    expect(mg.listDuskBranches()).toEqual([branchName(a)]); // b's branch never created
  });

  test("a malformed bead-id is refused with worktree_creation_failed", () => {
    const result = addWorktree(mg.repoDir, "not-a-bead-id", { baseRef: "origin/main" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.kind).toBe("worktree_creation_failed");
  });

  test("a missing baseRef fails LOUD — no implicit origin/main default (Phase 6 §A1)", () => {
    const result = addWorktree(mg.repoDir, newBeadId({ now: () => 1_000 }, 1), {});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.kind).toBe("worktree_creation_failed");
    expect(result.error.message).toContain("baseRef");
  });
});

describe("4.2 — dusk doctor --cleanup-worktrees reaps orphans, idempotent", () => {
  test("orphan worktree is reaped; second run is a silent no-op", () => {
    const handle = mg.createWorktree(); // simulate a crashed-run orphan
    expect(mg.worktreePaths()).toHaveLength(1);

    const reaped = cleanupOrphanWorktrees(mg.repoDir);
    expect(reaped).toEqual([handle.branch]);
    expect(mg.worktreePaths()).toHaveLength(0);
    expect(mg.listDuskBranches()).toEqual([]);

    expect(cleanupOrphanWorktrees(mg.repoDir)).toEqual([]); // idempotent
  });

  test("clean repo → cleanup reaps nothing", () => {
    expect(cleanupOrphanWorktrees(mg.repoDir)).toEqual([]);
  });

  test("newBeadId formats App. D.8 ids", () => {
    expect(newBeadId({ now: () => Date.parse("2026-06-10T12:30:45.000Z") }, 7)).toBe("bd_20260610123045007");
  });
});
