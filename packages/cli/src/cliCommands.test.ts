import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { SUB_AGENT_ROLES } from "@dusk/core-schema";
import { createTempRepo, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { inspectReport, renderInspect } from "./inspectReport.js";
import { listRoles } from "./roles.js";
import { listSkills } from "./skills.js";
import { scaffoldProject } from "./scaffold.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
  scaffoldProject(repo.dir);
});
afterEach(() => repo.cleanup());

describe("7.3 — dusk roles lists the nine installed role files", () => {
  test("nine roles in stable order with declared scopes", () => {
    const roles = listRoles(repo.dir);
    expect(roles.map((r) => r.role)).toEqual([...SUB_AGENT_ROLES]);
    const verifier = roles.find((r) => r.role === "verifier")!;
    expect(verifier.memory).toBe("none");
    expect(verifier.skillCount).toBe(4);
    expect(verifier.model).not.toBe("(missing)");
  });
});

describe("7.4 — dusk skills introspects role-bound skills grouped by role", () => {
  test("skills grouped by the .claude/skills/dusk/<role>/ layout", () => {
    const grouped = listSkills(repo.dir);
    expect(Object.keys(grouped)).toEqual(expect.arrayContaining(["engineer", "verifier", "author", "test-runner", "decomposer", "conflict-resolver"]));
    expect(grouped.verifier).toEqual(expect.arrayContaining(["triple-evaluation", "code-span-scoping", "polarity-aware-evaluation", "implies-evaluation"]));
  });
});

describe("7.2 — dusk inspect reports hierarchical satisfaction + low-confidence supports", () => {
  test("test-pyramid child shows unsatisfied until test code exists", () => {
    repo.write(".ia/intents/notifications/send/intent.yaml", "id: notifications/send\ndescription: d\nobligation: must\ntriples:\n  - id: persist\n    subject: s\n    predicate: p\n    object: o\n");
    repo.write(".ia/intents/notifications/send/unit-tests/intent.yaml", "id: notifications/send/unit-tests\ndescription: d\nobligation: must\ntriples:\n  - id: covers\n    subject: s\n    predicate: include\n    object: o\nrelates_to:\n  - kind: parent\n    target: notifications/send\n");
    const result = inspectReport(repo.dir, "notifications/send");
    expect(result.text).toContain("notifications/send/unit-tests");
    expect(result.text).toContain("Test-pyramid children");
  });

  test("renderInspect surfaces the low-confidence supports section", () => {
    const text = renderInspect("notifications/send", {
      intents: [{ path: "notifications/send", description: "d", obligation: "must", satisfied: true }],
      claims: [],
      support_claims: [],
      aspects_unsatisfied: [],
      test_intents: [],
      low_confidence_supports: [
        { intent_path: "notifications/send", aspect_id: "persist-first", claim: { file: "x.ts", lines: [1, 1], quote: "q" }, support_triple: ["a", "b", "c"], triple_verdict: "mismatch" },
      ],
    });
    expect(text).toContain("Low-confidence supports");
    expect(text).toContain("mismatch");
  });
});

describe("7.5 — every new command supports --help", () => {
  test.each(["verify", "inspect", "roles", "skills"])("dusk %s --help exits 0 with a usage substring", (command) => {
    const out = execFileSync("node", [CLI, command, "--help"], { cwd: repo.dir }).toString();
    expect(out).toContain(`dusk ${command}`);
  });
});
