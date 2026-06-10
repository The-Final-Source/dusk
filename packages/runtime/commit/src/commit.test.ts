import type { CommitTrailers } from "@dusk/core-schema";
import { createMockGitWorktree, type MockGitWorktree } from "@dusk/test-harness";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { commitBead } from "./commit.js";
import { renderTrailers } from "./render.js";

// §11.1 — Step-7 atomic commit + full trailer set (P3-T19).

const base: CommitTrailers = {
  intents: [{ intent_path: "api/pagination", aspect_ids: ["cursor-decode"] }],
  test_intents: ["api/pagination/unit-tests"],
  bead_id: "bd_20260610000000001",
  verdict_id: "vd_1",
  test_verdict_id: "tv_1",
  trace_id: "tr_1",
  verifier_model: "claude-sonnet-4-6",
  test_runner_model: "claude-sonnet-4-6",
  long_cycle_samples: 10,
  test_suites_passed: 1,
};

describe("trailer rendering (App. A.7 order + conditional gating)", () => {
  test("clean-converge bead has the complete unconditional set, no conditional trailers", () => {
    const lines = renderTrailers(base);
    expect(lines).toEqual([
      "Intent: api/pagination [cursor-decode]",
      "Test-Intent: api/pagination/unit-tests",
      "Bead-id: bd_20260610000000001",
      "Verdict-id: vd_1",
      "Test-Verdict-id: tv_1",
      "Trace-id: tr_1",
      "Verifier-model: claude-sonnet-4-6",
      "Test-Runner-model: claude-sonnet-4-6",
      "Long-cycle-samples: 10",
      "Test-Suites-passed: 1",
    ]);
    expect(lines.some((l) => l.startsWith("Partial"))).toBe(false);
    expect(lines.some((l) => l.startsWith("Deferred-Intent"))).toBe(false);
    expect(lines.some((l) => l.startsWith("Verifier-bypassed-test-intent"))).toBe(false);
  });

  test("L1 partial path adds Partial + one Deferred-Intent per deferred intent", () => {
    const lines = renderTrailers({ ...base, partial: true, deferred_intents: ["api/b", "api/c"] });
    expect(lines).toContain("Partial: true");
    expect(lines.filter((l) => l.startsWith("Deferred-Intent:"))).toEqual(["Deferred-Intent: api/b", "Deferred-Intent: api/c"]);
    // Conditional trailers come AFTER the unconditional set.
    expect(lines.indexOf("Partial: true")).toBeGreaterThan(lines.indexOf("Test-Suites-passed: 1"));
  });

  test("livelock accept_test_as_is path adds the Verifier-bypassed-test-intent trailer", () => {
    const lines = renderTrailers({
      ...base,
      verifier_bypassed_test_intents: [{ test_intent_path: "notifications/send/unit-tests", triple_id: "covers-persist-first" }],
    });
    expect(lines).toContain("Verifier-bypassed-test-intent: notifications/send/unit-tests[covers-persist-first]");
  });
});

describe("commitBead — exactly one commit on the bead's branch", () => {
  let mg: MockGitWorktree;
  beforeEach(() => {
    mg = createMockGitWorktree();
  });
  afterEach(() => mg.cleanup());

  test("produces one commit carrying the rendered message", () => {
    const handle = mg.createWorktree();
    writeFileSync(join(handle.path, "feature.ts"), "export const f = 1;\n");

    const result = commitBead({ worktreePath: handle.path, subject: "feat: add feature", trailers: { ...base, bead_id: handle.beadId } });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.commit_sha).toMatch(/^[0-9a-f]{40}$/);

    // Exactly one commit beyond the base on this branch.
    const count = execFileSync("git", ["rev-list", "--count", "origin/main..HEAD"], { cwd: handle.path, encoding: "utf8" }).trim();
    expect(count).toBe("1");
    const message = execFileSync("git", ["log", "-1", "--format=%B"], { cwd: handle.path, encoding: "utf8" });
    expect(message).toContain("feat: add feature");
    expect(message).toContain("Bead-id: " + handle.beadId);
    expect(message).toContain("Long-cycle-samples: 10");
  });
});
