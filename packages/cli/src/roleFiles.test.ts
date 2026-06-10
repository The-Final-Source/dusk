import { createTempRepo, type TempRepo } from "@dusk/test-harness";
import { type SubAgentRole, SUB_AGENT_ROLES } from "@dusk/core-schema";
import { checkRoleVersion, loadRoleFile } from "@dusk/runtime-orchestrator";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { scaffoldProject } from "./scaffold.js";

// Task 2.7 — nine role files exist with v9 frontmatter + complete bodies;
// dusk-verifier.md ships the complete two-path template with ≥4 few-shots.

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
  scaffoldProject(repo.dir);
});
afterEach(() => repo.cleanup());

describe("canonical role files", () => {
  test("all nine roles load through the real loader with v9 frontmatter", () => {
    expect(SUB_AGENT_ROLES).toHaveLength(9);
    for (const role of SUB_AGENT_ROLES as readonly SubAgentRole[]) {
      const loaded = loadRoleFile(repo.dir, role);
      expect(loaded.success, `role ${role} should load`).toBe(true);
      if (!loaded.success) continue;
      expect(loaded.value.frontmatter.dusk_role_version).toBe(2);
      expect(checkRoleVersion(role, loaded.value.frontmatter)).toBeNull();
      expect(["none", "bead", "dialog", "session"]).toContain(loaded.value.frontmatter.memory);
      expect(loaded.value.body.length).toBeGreaterThan(50);
    }
  });

  test("dusk-verifier.md ships the two-path template, affirmative contract, and ≥4 few-shots", () => {
    const loaded = loadRoleFile(repo.dir, "verifier");
    expect(loaded.success).toBe(true);
    if (!loaded.success) return;
    const { frontmatter, body } = loaded.value;

    expect(frontmatter.memory).toBe("none");
    expect(frontmatter.model).toBeDefined();
    expect(frontmatter.skills).toContain("dusk/verifier/triple-evaluation");

    expect(body).toContain("Affirmative-framing contract");
    expect(body).toContain("Two-path execution");
    // No "invert if negated" branch — the runtime inverts, not the model.
    expect(body.toLowerCase()).toContain("never invert");

    const fewShots = body.match(/### Few-shot \d/g) ?? [];
    expect(fewShots.length).toBeGreaterThanOrEqual(4);
  });
});
