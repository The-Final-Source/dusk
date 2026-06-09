import { describe, test, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTempRepo } from "@dusk/test-harness";

import { initProject } from "./init.js";
import { DUSK_MARKER } from "./settingsMerge.js";

const GATE = fileURLToPath(new URL("../../delivery/pre-tool-use/dist/cli.js", import.meta.url));
const hookCommand = `node ${GATE}`;

type Settings = { hooks?: { PreToolUse?: Array<Record<string, unknown>> } };
const readSettings = (root: string): Settings => JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
const duskEntries = (s: Settings) => (s.hooks?.PreToolUse ?? []).filter((e) => e._dusk_marker === DUSK_MARKER);
const seedForeign = (root: string): void => {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude/settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ type: "command", match: { tools: ["Write"] }, command: "node other.js" }] } }));
};

describe("dusk init (P1-T13/14)", () => {
  test("installs the gate and is idempotent by marker", () => {
    const repo = createTempRepo({ git: false });
    initProject(repo.dir, { hookCommand });
    initProject(repo.dir, { hookCommand });
    const settings = readSettings(repo.dir);
    expect(duskEntries(settings)).toHaveLength(1);
    expect(repo.exists("dusk.config.yml")).toBe(true);
    expect(repo.exists(".claude/agents/dusk-verifier.md")).toBe(true);
    repo.cleanup();
  });

  test("conflict — append keeps both", () => {
    const repo = createTempRepo({ git: false });
    seedForeign(repo.dir);
    initProject(repo.dir, { hookCommand, conflictResolver: () => "append" });
    expect(readSettings(repo.dir).hooks?.PreToolUse).toHaveLength(2);
    repo.cleanup();
  });

  test("conflict — replace backs up and records the replaced command", () => {
    const repo = createTempRepo({ git: false });
    seedForeign(repo.dir);
    initProject(repo.dir, { hookCommand, conflictResolver: () => "replace" });
    const settings = readSettings(repo.dir);
    expect(duskEntries(settings)).toHaveLength(1);
    expect((settings.hooks?.PreToolUse ?? []).some((e) => e._dusk_replaced === "node other.js")).toBe(true);
    expect(existsSync(join(repo.dir, ".claude/settings.json.bak"))).toBe(true);
    repo.cleanup();
  });

  test("conflict — abort leaves settings unchanged", () => {
    const repo = createTempRepo({ git: false });
    seedForeign(repo.dir);
    const result = initProject(repo.dir, { hookCommand, conflictResolver: () => "abort" });
    expect(result.action).toBe("aborted");
    expect(duskEntries(readSettings(repo.dir))).toHaveLength(0);
    repo.cleanup();
  });
});
