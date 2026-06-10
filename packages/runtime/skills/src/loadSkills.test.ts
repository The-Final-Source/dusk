import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createTempRepo, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadSkills, renderSkillsBlock } from "./loadSkills.js";

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
  const dir = join(repo.dir, ".claude/skills/dusk/engineer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "decoration-completeness.md"),
    "---\nname: decoration-completeness\n---\n\nEvery statement must carry a decorator.\n",
  );
  // An extra, undeclared skill file in the same directory:
  writeFileSync(join(dir, "unlisted-skill.md"), "---\nname: unlisted\n---\n\nSHOULD NOT BE INJECTED.\n");
});
afterEach(() => repo.cleanup());

describe("loadSkills", () => {
  test("loads only the declared skills, ignoring extra files in the directory", () => {
    const loaded = loadSkills(repo.dir, ["dusk/engineer/decoration-completeness"]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].found).toBe(true);
    expect(loaded[0].body).toContain("Every statement must carry a decorator.");

    const block = renderSkillsBlock(loaded);
    expect(block).toContain("Every statement must carry a decorator.");
    expect(block).not.toContain("SHOULD NOT BE INJECTED");
  });

  test("a missing declared skill is surfaced as found:false, not an error", () => {
    const loaded = loadSkills(repo.dir, ["dusk/engineer/does-not-exist"]);
    expect(loaded[0].found).toBe(false);
    expect(loaded[0].body).toBe("");
  });
});
