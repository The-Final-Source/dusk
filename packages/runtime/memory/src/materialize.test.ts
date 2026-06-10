import { existsSync } from "node:fs";

import { createTempRepo, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { materializeMemory, memoryFilePath, writeBackMemory } from "./materialize.js";

// Task 3.1 — four-scope materializer (zero-model).

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
});
afterEach(() => repo.cleanup());

describe("materializeMemory", () => {
  test("first bead spawn finds no memory file and renders empty, creating nothing", () => {
    const result = materializeMemory({ rootDir: repo.dir, scope: "bead", role: "engineer", ids: { beadId: "bd_1" } });
    expect(result.rendering).toBe("");
    expect(result.exists).toBe(false);
    expect(existsSync(memoryFilePath(repo.dir, "bead", "engineer", { beadId: "bd_1" })!)).toBe(false);
  });

  test("memory: none renders the empty block even when a bead file exists", () => {
    writeBackMemory({
      rootDir: repo.dir,
      scope: "bead",
      role: "engineer",
      ids: { beadId: "bd_1" },
      content: "## Current diagnosis\nSENTINEL-DIAGNOSIS-XYZ\n",
    });
    const result = materializeMemory({ rootDir: repo.dir, scope: "none", role: "verifier", ids: { beadId: "bd_1" } });
    expect(result.rendering).toBe("");
    expect(result.path).toBeNull();
  });

  test("session memory round-trips written content across spawns", () => {
    const first = materializeMemory({ rootDir: repo.dir, scope: "session", role: "root-orchestrator" });
    expect(first.rendering).toBe("");

    writeBackMemory({
      rootDir: repo.dir,
      scope: "session",
      role: "root-orchestrator",
      content: "session note: bead bd_1 dispatched\n",
    });

    const second = materializeMemory({ rootDir: repo.dir, scope: "session", role: "root-orchestrator" });
    expect(second.rendering).toContain("session note: bead bd_1 dispatched");
    expect(second.exists).toBe(true);
  });
});
