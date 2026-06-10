import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BeadDag } from "@dusk/core-schema";
import { createMockGitWorktree, type MockGitWorktree } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { detectDrift } from "./drift.js";
import { runMerge } from "./merge.js";
import { topoOrder } from "./topo.js";

// §11.2/11.3 — Step-8 topological rebase + drift detection (P3-T20).

describe("topoOrder", () => {
  test("a dependency-linked pair A←B with independent C never lands B before A", () => {
    const dag: BeadDag = {
      nodes: [{ bead_id: "A", intent_paths: [], predicted_files: [] }, { bead_id: "B", intent_paths: [], predicted_files: [] }, { bead_id: "C", intent_paths: [], predicted_files: [] }],
      edges: [{ from: "B", to: "A", source: "typed-relates-to", kind: "implies" }],
    };
    const order = topoOrder(dag);
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
  });
});

describe("11.2 — Step-8 topological rebase + worktree removal (real git)", () => {
  let mg: MockGitWorktree;
  beforeEach(() => {
    mg = createMockGitWorktree();
  });
  afterEach(() => mg.cleanup());

  test("rebases A before B; lands all commits on main; removes worktrees", () => {
    const a = mg.createWorktree();
    const b = mg.createWorktree();
    const c = mg.createWorktree();
    // Each bead commits a distinct file in its own worktree.
    for (const [h, name] of [[a, "a"], [b, "b"], [c, "c"]] as const) {
      writeFileSync(join(h.path, `${name}.ts`), `export const ${name} = 1;\n`);
      execFileSync("git", ["add", "-A"], { cwd: h.path });
      execFileSync("git", ["commit", "-q", "-m", `feat: ${name}`], { cwd: h.path });
    }

    const dag: BeadDag = {
      nodes: [
        { bead_id: a.beadId, intent_paths: [], predicted_files: [] },
        { bead_id: b.beadId, intent_paths: [], predicted_files: [] },
        { bead_id: c.beadId, intent_paths: [], predicted_files: [] },
      ],
      edges: [{ from: b.beadId, to: a.beadId, source: "typed-relates-to", kind: "implies" }],
    };

    const result = runMerge({ repoDir: mg.repoDir, dag });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.value.rebasedOrder.indexOf(a.beadId)).toBeLessThan(result.value.rebasedOrder.indexOf(b.beadId));
    expect(mg.worktreePaths()).toHaveLength(0); // all worktrees removed
    expect(mg.listDuskBranches()).toEqual([]); // branches deleted
    // All three commits landed on main.
    const log = execFileSync("git", ["log", "--format=%s"], { cwd: mg.repoDir, encoding: "utf8" });
    expect(log).toContain("feat: a");
    expect(log).toContain("feat: b");
    expect(log).toContain("feat: c");
  });
});

describe("11.3 — Partial: true-aware drift detection", () => {
  test("partial commit's deferred-intent additions do NOT trigger drift; foreign decoration does", () => {
    // L1 partial: deferred-intent decoration is the branch's own expected work.
    const partial = detectDrift({
      mainDecorations: ["f.ts:10:api/a", "f.ts:20:api/b"],
      snapshotDecorations: ["f.ts:10:api/a"],
      branchExpectedAdditions: [],
      partial: true,
      deferredAdditions: ["f.ts:20:api/b"],
    });
    expect(partial).toHaveLength(0); // deferred addition recognized

    // Non-partial with a foreign decoration → drift fires.
    const drift = detectDrift({
      mainDecorations: ["f.ts:10:api/a", "g.ts:5:foreign/intent"],
      snapshotDecorations: ["f.ts:10:api/a"],
      branchExpectedAdditions: [],
    });
    expect(drift).toHaveLength(1);
    expect(drift[0]).toEqual({ kind: "snapshot_drift", decoration: "g.ts:5:foreign/intent" });
  });
});
