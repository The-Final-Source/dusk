import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CommitTrailers } from "@dusk/core-schema";
import { createMockGitWorktree, type MockGitWorktree } from "@dusk/test-harness";
import { parse as yamlParse } from "yaml";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { decideLadderLevel, type LadderInputs } from "./decision.js";
import { runRecoveryLadder } from "./run.js";

// §7 recovery-ladder.

describe("7.1 — deterministic decision function (2^3 = 8 combinations)", () => {
  const cases: Array<[LadderInputs, "L1" | "L2" | "L3" | "L4"]> = [
    [{ canPartialCommit: true, proposalGenerationSucceeds: true, freezeWritable: true }, "L1"],
    [{ canPartialCommit: true, proposalGenerationSucceeds: true, freezeWritable: false }, "L1"],
    [{ canPartialCommit: true, proposalGenerationSucceeds: false, freezeWritable: true }, "L1"],
    [{ canPartialCommit: true, proposalGenerationSucceeds: false, freezeWritable: false }, "L1"],
    [{ canPartialCommit: false, proposalGenerationSucceeds: true, freezeWritable: true }, "L2"],
    [{ canPartialCommit: false, proposalGenerationSucceeds: true, freezeWritable: false }, "L2"],
    [{ canPartialCommit: false, proposalGenerationSucceeds: false, freezeWritable: true }, "L3"],
    [{ canPartialCommit: false, proposalGenerationSucceeds: false, freezeWritable: false }, "L4"],
  ];

  for (const [inputs, expected] of cases) {
    test(`${JSON.stringify(inputs)} → ${expected}`, () => {
      expect(decideLadderLevel(inputs)).toBe(expected);
    });
  }

  test("a zero-satisfiable bead emits L2 (recoverable), NOT L4 (the round-4 fix)", () => {
    expect(decideLadderLevel({ canPartialCommit: false, proposalGenerationSucceeds: true, freezeWritable: true })).toBe("L2");
  });
});

const trailers = (beadId: string): CommitTrailers => ({
  intents: [
    { intent_path: "api/a", aspect_ids: ["t1"] },
    { intent_path: "api/b", aspect_ids: ["t1"] },
  ],
  test_intents: [],
  bead_id: beadId,
  verdict_id: "vd_1",
  trace_id: "tr_1",
  verifier_model: "claude-sonnet-4-6",
  long_cycle_samples: 10,
  test_suites_passed: 0,
});

describe("7.2–7.5 — ladder actions", () => {
  let mg: MockGitWorktree;
  beforeEach(() => {
    mg = createMockGitWorktree();
  });
  afterEach(() => mg.cleanup());

  test("L1 partial commit: Partial + Deferred-Intent trailers + deferred.yaml (P3-T11)", () => {
    const handle = mg.createWorktree();
    writeFileSync(join(handle.path, "a.ts"), "export const a = 1;\n");

    const result = runRecoveryLadder({
      rootDir: handle.path,
      beadId: handle.beadId,
      worktreePath: handle.path,
      satisfiedIntents: ["api/a"],
      deferredIntents: ["api/b"],
      diagnosisHistory: [],
      lastVerdicts: [],
      beadMemory: "",
      trailers: trailers(handle.beadId),
      subject: "feat: partial — api/a only",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const outcome = result.value;
    expect(outcome.level).toBe("L1");
    if (outcome.level !== "L1") return;

    expect(existsSync(join(handle.path, ".ia/runtime/beads", handle.beadId, "deferred.yaml"))).toBe(true);
    const deferred = yamlParse(readFileSync(join(handle.path, ".ia/runtime/beads", handle.beadId, "deferred.yaml"), "utf8"));
    expect(deferred.deferred_intents).toEqual(["api/b"]);
    expect(outcome.commit.message).toContain("Partial: true");
    expect(outcome.commit.message).toContain("Deferred-Intent: api/b");
    expect(outcome.commit.message).toContain("Intent: api/a [t1]");
    expect(outcome.commit.message).not.toMatch(/\nIntent: api\/b/); // no focal Intent trailer for the deferred one
  });

  test("L2 proposal: intent-proposal.yaml aggregates ALL diagnoses + recoverable error (P3-T12)", () => {
    const beadId = mg.nextBeadId();
    const result = runRecoveryLadder({
      rootDir: mg.repoDir,
      beadId,
      worktreePath: mg.repoDir,
      satisfiedIntents: [], // zero satisfiable
      deferredIntents: ["api/a", "api/b"],
      diagnosisHistory: [
        { iter: 3, text: "triple t1 of api/a appears unsatisfiable" },
        { iter: 6, text: "second diagnosis: object slot too strong" },
      ],
      lastVerdicts: [],
      beadMemory: "",
      trailers: trailers(beadId),
      subject: "x",
    });
    expect(result.success).toBe(true);
    if (!result.success || result.value.level !== "L2") return;
    const outcome = result.value;
    expect(outcome.error.kind).toBe("bead_intent_revision_needed");
    expect(outcome.error.recoverable).toBe(true);
    expect(outcome.error.recovery_hint).toContain("dusk_author_continue");
    const proposal = yamlParse(readFileSync(outcome.proposalPath, "utf8"));
    expect(proposal.diagnoses).toHaveLength(2); // ALL lifetime diagnoses aggregated
  });

  test("L3 freeze: worktree preserved + freeze-state.md + bead_frozen (P3-T12b)", () => {
    const handle = mg.createWorktree();
    const result = runRecoveryLadder({
      rootDir: mg.repoDir,
      beadId: handle.beadId,
      worktreePath: handle.path,
      satisfiedIntents: [],
      deferredIntents: ["api/a"],
      proposalGenerationSucceeds: false, // force the L3 branch
      diagnosisHistory: [{ iter: 5, text: "stuck on t1" }],
      lastVerdicts: [{ iter: 6, decision: "reject", triple_id: "api/a[t1]", rationale: "mismatch" }],
      beadMemory: "## Current diagnosis\nstuck on t1\n",
      trailers: trailers(handle.beadId),
      subject: "x",
    });
    expect(result.success).toBe(true);
    if (!result.success || result.value.level !== "L3") return;
    const outcome = result.value;
    expect(outcome.error.kind).toBe("bead_frozen");
    expect(outcome.error.recoverable).toBe(false);
    expect(existsSync(outcome.freezePath)).toBe(true);
    expect(readFileSync(outcome.freezePath, "utf8")).toContain("Last 3 verdicts");
    expect(existsSync(handle.path)).toBe(true); // worktree preserved
  });

  test("L4 hard abort: ONLY when freeze serialization fails (P3-T12c)", () => {
    const beadId = mg.nextBeadId();
    const result = runRecoveryLadder({
      rootDir: mg.repoDir,
      beadId,
      worktreePath: mg.repoDir,
      satisfiedIntents: [],
      deferredIntents: ["api/a"],
      proposalGenerationSucceeds: false,
      diagnosisHistory: [],
      lastVerdicts: [],
      beadMemory: "",
      trailers: trailers(beadId),
      subject: "x",
      freezeWriter: () => {
        throw new Error("ENOSPC: disk full");
      },
    });
    expect(result.success).toBe(true);
    if (!result.success || result.value.level !== "L4") return;
    expect(result.value.error.kind).toBe("bead_aborted");
  });

  test("nothing-satisfiable does NOT trigger L4 (it's L2) — P3-T12c negative", () => {
    const beadId = mg.nextBeadId();
    const result = runRecoveryLadder({
      rootDir: mg.repoDir,
      beadId,
      worktreePath: mg.repoDir,
      satisfiedIntents: [], // nothing satisfiable
      deferredIntents: ["api/a"],
      // proposalGenerationSucceeds defaults to true → L2
      diagnosisHistory: [{ iter: 4, text: "x" }],
      lastVerdicts: [],
      beadMemory: "",
      trailers: trailers(beadId),
      subject: "x",
    });
    expect(result.success && result.value.level === "L2").toBe(true);
  });
});
