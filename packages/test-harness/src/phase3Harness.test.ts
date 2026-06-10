import { existsSync, readFileSync } from "node:fs";

import { afterEach, describe, expect, test } from "vitest";

import { DAY_MS, HOUR_MS, mockClock } from "./clock.js";
import { createMockGitWorktree, type MockGitWorktree } from "./gitWorktree.js";
import { writeStallingFixture } from "./stallingFixture.js";
import { makeVitestJsonReport } from "./vitestReport.js";

// Task 1.3 — the Phase-3 test-harness extensions are wiring exercised here.

describe("MockGitWorktree (1.3a)", () => {
  let mg: MockGitWorktree | undefined;
  afterEach(() => mg?.cleanup());

  test("sets up origin/main and creates a real dusk/<bead-id> worktree", () => {
    mg = createMockGitWorktree({ files: { "src/a.ts": "export const a = 1;\n" } });
    const handle = mg.createWorktree();
    expect(handle.branch).toMatch(/^dusk\/bd_[0-9]{14}[0-9]{3}$/);
    expect(existsSync(handle.path)).toBe(true);
    expect(mg.listDuskBranches()).toContain(handle.branch);
    // git canonicalizes paths (macOS /var → /private/var); compare by bead-id.
    expect(mg.worktreePaths().some((p) => p.endsWith(handle.beadId))).toBe(true);
  });

  test("bead-ids are deterministic and monotonic", () => {
    mg = createMockGitWorktree({ idBase: "20260610120000" });
    expect(mg.nextBeadId()).toBe("bd_20260610120000001");
    expect(mg.nextBeadId()).toBe("bd_20260610120000002");
  });
});

describe("MockClock advance helper (1.3b)", () => {
  test("advance moves past a 24h TTL boundary", () => {
    const clock = mockClock(0);
    clock.advance(DAY_MS + HOUR_MS);
    expect(clock.now()).toBe(25 * HOUR_MS);
  });
});

describe("stalling-fixture builder (1.3c)", () => {
  let mg: MockGitWorktree | undefined;
  afterEach(() => mg?.cleanup());

  test("writes a contradictory intent and a decorated source file", () => {
    mg = createMockGitWorktree();
    const fixture = writeStallingFixture(mg.repoDir);
    expect(existsSync(fixture.intentFile)).toBe(true);
    expect(existsSync(fixture.sourceFile)).toBe(true);
    expect(fixture.tripleIds.length).toBeGreaterThanOrEqual(2);
    const src = readFileSync(fixture.sourceFile, "utf8");
    expect(src).toContain(`@intent ${fixture.intentPath}`);
  });
});

describe("scripted Vitest reporter (1.3d)", () => {
  test("groups specs by file and rolls up pass/fail counts", () => {
    const report = makeVitestJsonReport([
      { file: "/x/a.test.ts", title: "passes", status: "passed", duration: 3 },
      { file: "/x/a.test.ts", title: "also passes", status: "passed" },
      { file: "/x/b.test.ts", title: "fails", status: "failed" },
    ]);
    expect(report.numTotalTests).toBe(3);
    expect(report.numPassedTests).toBe(2);
    expect(report.numFailedTests).toBe(1);
    expect(report.testResults).toHaveLength(2);
    expect(report.testResults.find((r) => r.name === "/x/b.test.ts")?.status).toBe("failed");
  });
});
