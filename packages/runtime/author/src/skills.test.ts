import { cpSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { readRuntimeEnv, spawnSubAgent, type TaskRunner } from "@dusk/runtime-orchestrator";
import { createTempRepo, fixedClock, readTraces } from "@dusk/test-harness";

/**
 * 3.11 — the seven Author skills ship with concrete authoring guidance
 * (zero-model + real fs). Each file is substantive (≥30 lines of guidance, not
 * a stub) and the Phase-2 spawn pipeline injects all seven into the Author
 * spawn payload, enumerated on `SubAgentTrace.skills_loaded[]`.
 */

const SEVEN_SKILLS = [
  "polarity-decision",
  "typed-relates-to",
  "implies-antecedent-grammar",
  "tension-detection",
  "discovery-grep-patterns",
  "best-practices-application",
  "test-pyramid-proposal",
] as const;

const here = dirname(fileURLToPath(import.meta.url));
const cliAssets = join(here, "..", "..", "..", "cli", "assets");

const substantiveLines = (content: string): number =>
  content
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .split("\n")
    .filter((line) => line.trim().length > 0).length;

describe("3.11 — seven Author skills with concrete guidance", () => {
  test("every skill file is present in the bundled assets with ≥30 substantive lines", () => {
    for (const skill of SEVEN_SKILLS) {
      const path = join(cliAssets, "skills", "dusk", "author", `${skill}.md`);
      const content = readFileSync(path, "utf8");
      expect(substantiveLines(content), `${skill} must not be a stub`).toBeGreaterThanOrEqual(30);
    }
  });

  test("the Author spawn payload includes all seven skills; the trace enumerates them", async () => {
    const repo = createTempRepo({ git: false });
    cpSync(join(cliAssets, "agents"), join(repo.dir, ".claude/agents"), { recursive: true });
    cpSync(join(cliAssets, "skills", "dusk"), join(repo.dir, ".claude/skills/dusk"), { recursive: true });

    const taskRunner: TaskRunner = async () => ({ output: '{"question": "stub"}', model: "stub", promptTokens: 1, completionTokens: 1, latencyMs: 1, costUsd: 0 });
    const result = await spawnSubAgent(
      { role: "author", dialogId: "dlg_20260610120000001", sessionId: "s1", input: "Stage 1 framing", invocationSite: "author" },
      { rootDir: repo.dir, env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }), clock: fixedClock(Date.UTC(2026, 5, 10)), taskRunner },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    for (const skill of SEVEN_SKILLS) {
      expect(result.value.assembledPrompt).toContain(`dusk/author/${skill}`);
    }
    const trace = readTraces(repo.dir).at(-1)!;
    expect(trace.skills_loaded).toEqual(SEVEN_SKILLS.map((s) => `dusk/author/${s}`));
    repo.cleanup();
  });
});
