import { describe, test, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTempRepo } from "@dusk/test-harness";

import { initProject } from "./init.js";
import { checkHook } from "./checkHook.js";
import { DUSK_MARKER } from "./settingsMerge.js";

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

  test("exit 2 on a marker-bearing LEGACY-shape entry (Claude Code never fires it); --repair migrates it", () => {
    // The exact bug class: a dusk-marked entry in the old { match, type, command }
    // shape stamped v1 — Claude Code silently never fired it, but the old checkHook
    // (marker + standalone round-trip only) green-lit it. The shape+version gate
    // must REJECT it, and --repair must migrate it to the firing { matcher, hooks } shape.
    const repo = createTempRepo({ git: false });
    mkdirSync(join(repo.dir, ".claude"), { recursive: true });
    const legacy = { _dusk_marker: DUSK_MARKER, _dusk_managed: "v1", type: "command", match: { tools: ["Write", "Edit"] }, command: hookCommand };
    writeFileSync(join(repo.dir, ".claude/settings.json"), JSON.stringify({ hooks: { PreToolUse: [legacy] } }));
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
