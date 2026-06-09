import { describe, test, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTempRepo } from "@dusk/test-harness";

import { initProject } from "./init.js";
import { checkHook } from "./checkHook.js";

const GATE = fileURLToPath(new URL("../../delivery/pre-tool-use/dist/cli.js", import.meta.url));
const hookCommand = `node ${GATE}`;

describe("dusk doctor --check-hook (P1-T15)", () => {
  test("exit 0 on a correct install", () => {
    const repo = createTempRepo({ git: false });
    initProject(repo.dir, { hookCommand });
    expect(checkHook(repo.dir, { hookCommand }).exitCode).toBe(0);
    repo.cleanup();
  });

  test("exit 2 when the marker is missing; --repair fixes it", () => {
    const repo = createTempRepo({ git: false });
    mkdirSync(join(repo.dir, ".claude"), { recursive: true });
    writeFileSync(join(repo.dir, ".claude/settings.json"), JSON.stringify({ hooks: { PreToolUse: [] } }));
    expect(checkHook(repo.dir, { hookCommand }).exitCode).toBe(2);
    expect(checkHook(repo.dir, { repair: true, hookCommand }).exitCode).toBe(0);
    repo.cleanup();
  });

  test("exit 3 on a malfunctioning handler; --repair does NOT auto-fix", () => {
    const repo = createTempRepo({ git: false });
    const broken = join(repo.dir, "broken.cjs");
    writeFileSync(broken, "process.stdout.write('not json');");
    const brokenCommand = `node ${broken}`;
    initProject(repo.dir, { hookCommand: brokenCommand });
    expect(checkHook(repo.dir, { hookCommand: brokenCommand }).exitCode).toBe(3);
    expect(checkHook(repo.dir, { repair: true, hookCommand: brokenCommand }).exitCode).toBe(3);
    repo.cleanup();
  });
});
