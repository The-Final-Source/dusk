import {
  createTempRepo,
  fixedClock,
  makeScriptedVerdictFactory,
  readTraces,
  type TempRepo,
} from "@dusk/test-harness";
import type { Verdict } from "@dusk/core-schema";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { readRuntimeEnv } from "./env.js";
import { spawnSubAgent, type SpawnDeps, type TaskCall, type TaskRunner } from "./spawn.js";

// Tasks 2.2–2.6 + 3.5 — spawn pipeline (zero-model, scripted-verdict double).

const SENTINEL_DIAGNOSIS = "SENTINEL-DIAGNOSIS-9f3a-do-not-leak";

function roleFile(
  slug: string,
  fm: { memory: string; skills?: string[]; tools?: string[]; model?: string; version?: number },
  body: string,
): string {
  return [
    "---",
    `dusk_role_version: ${fm.version ?? 2}`,
    `name: dusk-${slug}`,
    "description: test role",
    `tools: [${(fm.tools ?? ["Read"]).join(", ")}]`,
    `memory: ${fm.memory}`,
    `skills: [${(fm.skills ?? []).join(", ")}]`,
    `model: ${fm.model ?? "claude-sonnet-4-6"}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

const skillFile = (leaf: string, body: string): string => `---\nname: ${leaf}\n---\n\n${body}\n`;

function recordingTaskRunner(): { runner: TaskRunner; calls: TaskCall[] } {
  const calls: TaskCall[] = [];
  const runner: TaskRunner = async (call) => {
    calls.push(call);
    return { output: "done", model: "claude-sonnet-4-6", promptTokens: 120, completionTokens: 40, costUsd: 0.0021, latencyMs: 15 };
  };
  return { runner, calls };
}

const cannedVerdict = (intentPath: string): Verdict => ({
  intent_path: intentPath,
  decision: "accept",
  per_triple: [],
  aggregate_rationale: "scripted",
});

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });

  // Engineer: bead memory, three declared skills (+ an undeclared extra file on disk).
  repo.write(
    ".claude/agents/dusk-engineer.md",
    roleFile(
      "engineer",
      {
        memory: "bead",
        tools: ["Read", "Edit"],
        skills: [
          "dusk/engineer/decoration-completeness",
          "dusk/engineer/statement-extraction",
          "dusk/engineer/support-triple-authoring",
        ],
      },
      "# Dusk Engineer\nROLE-BODY-ENGINEER-MARKER",
    ),
  );
  repo.write(".claude/skills/dusk/engineer/decoration-completeness.md", skillFile("decoration-completeness", "SKILL-BODY-DECORATION"));
  repo.write(".claude/skills/dusk/engineer/statement-extraction.md", skillFile("statement-extraction", "SKILL-BODY-EXTRACTION"));
  repo.write(".claude/skills/dusk/engineer/support-triple-authoring.md", skillFile("support-triple-authoring", "SKILL-BODY-SUPPORT"));
  repo.write(".claude/skills/dusk/engineer/unlisted-extra.md", skillFile("unlisted", "SKILL-BODY-UNLISTED-SHOULD-NOT-APPEAR"));

  // Verifier: memory none, one skill.
  repo.write(
    ".claude/agents/dusk-verifier.md",
    roleFile("verifier", { memory: "none", tools: ["Read"], skills: ["dusk/verifier/triple-evaluation"] }, "# Dusk Verifier\nROLE-BODY-VERIFIER-MARKER"),
  );
  repo.write(".claude/skills/dusk/verifier/triple-evaluation.md", skillFile("triple-evaluation", "SKILL-BODY-TRIPLE-EVAL"));

  // Bead Orchestrator: bead memory (carries the diagnosis).
  repo.write(".claude/agents/dusk-bead.md", roleFile("bead", { memory: "bead", skills: [] }, "# Dusk Bead Orchestrator\nROLE-BODY-BEAD-MARKER"));

  // Populated engineer bead memory with a seeded diagnosis sentinel.
  repo.write(
    ".ia/runtime/beads/bd_1/engineer.md",
    `---\nbead_id: bd_1\nrole: engineer\nlast_iter: 3\nlast_compacted_at_iter: 0\n---\n\n## Current diagnosis\n${SENTINEL_DIAGNOSIS}\n\n## Approaches tried (impl)\n(none)\n`,
  );
  // The Bead Orchestrator's own memory also carries the diagnosis.
  repo.write(
    ".ia/runtime/beads/bd_1/bead-orchestrator.md",
    `---\nbead_id: bd_1\nrole: bead-orchestrator\nlast_iter: 3\nlast_compacted_at_iter: 0\n---\n\n## Current diagnosis\n${SENTINEL_DIAGNOSIS}\n`,
  );
});
afterEach(() => repo.cleanup());

function deps(overrides: Partial<SpawnDeps> = {}): SpawnDeps {
  return {
    rootDir: repo.dir,
    env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }),
    clock: fixedClock(1_000),
    taskRunner: recordingTaskRunner().runner,
    ...overrides,
  };
}

describe("2.2 — spawn assembles role + memory + skills before the Task call", () => {
  test("Engineer spawn includes role body, all three skill bodies, and bead memory", async () => {
    const tr = recordingTaskRunner();
    const result = await spawnSubAgent(
      { role: "engineer", beadId: "bd_1", sessionId: "s1", input: "implement persist-first" },
      deps({ taskRunner: tr.runner }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const prompt = result.value.assembledPrompt;
    expect(prompt).toContain("ROLE-BODY-ENGINEER-MARKER");
    expect(prompt).toContain("SKILL-BODY-DECORATION");
    expect(prompt).toContain("SKILL-BODY-EXTRACTION");
    expect(prompt).toContain("SKILL-BODY-SUPPORT");
    expect(prompt).toContain(SENTINEL_DIAGNOSIS); // engineer DOES see its own bead memory
    // Task called once with dusk-engineer.
    expect(tr.calls).toHaveLength(1);
    expect(tr.calls[0].subagentType).toBe("dusk-engineer");
  });

  test("Verifier spawn (memory: none) contains zero substrings of the seeded diagnosis", async () => {
    const result = await spawnSubAgent(
      { role: "verifier", beadId: "bd_1", sessionId: "s1", input: "evaluate triple", intentPath: "notifications/send" },
      deps({ verifierFactory: makeScriptedVerdictFactory([cannedVerdict("notifications/send")]) }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.assembledPrompt).not.toContain(SENTINEL_DIAGNOSIS);
    expect(result.value.assembledPrompt).toContain("ROLE-BODY-VERIFIER-MARKER");
  });
});

describe("2.3 / P2-T19 — role-version enforcement", () => {
  test("an out-of-range dusk_role_version is refused with no Task call", async () => {
    repo.write(".claude/agents/dusk-engineer.md", roleFile("engineer", { memory: "bead", version: 999 }, "# x"));
    const tr = recordingTaskRunner();
    const result = await spawnSubAgent({ role: "engineer", beadId: "bd_1", sessionId: "s1", input: "x" }, deps({ taskRunner: tr.runner }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.kind).toBe("config_invalid");
    expect(result.error.message).toContain("999");
    expect(tr.calls).toHaveLength(0);
    expect(readTraces(repo.dir)).toHaveLength(0);
  });
});

describe("2.4 / P2-T4 — every spawn emits a SubAgentTrace", () => {
  test("Engineer spawn writes exactly one trace with skills_loaded matching frontmatter", async () => {
    await spawnSubAgent({ role: "engineer", beadId: "bd_1", sessionId: "s1", input: "x" }, deps());
    const traces = readTraces(repo.dir);
    expect(traces).toHaveLength(1);
    expect(traces[0].role).toBe("engineer");
    expect(traces[0].skills_loaded).toEqual([
      "dusk/engineer/decoration-completeness",
      "dusk/engineer/statement-extraction",
      "dusk/engineer/support-triple-authoring",
    ]);
    expect(traces[0].prompt_tokens).toBe(120);
    expect(traces[0].cost_usd).toBeCloseTo(0.0021);
  });
});

describe("2.5 — raw_prompt is test/benchmark-only, with redaction", () => {
  test("test mode captures raw_prompt; production mode omits it", async () => {
    await spawnSubAgent({ role: "engineer", beadId: "bd_1", sessionId: "s1", input: "x" }, deps({ env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }) }));
    const testTrace = readTraces(repo.dir).at(-1)!;
    expect(testTrace.raw_prompt).toBeDefined();
    expect(testTrace.raw_prompt).toContain("ROLE-BODY-ENGINEER-MARKER");

    const prodRepo = createTempRepo({ git: false });
    prodRepo.write(".claude/agents/dusk-engineer.md", roleFile("engineer", { memory: "none", skills: [] }, "# E"));
    await spawnSubAgent(
      { role: "engineer", sessionId: "s1", input: "x" },
      { rootDir: prodRepo.dir, env: readRuntimeEnv({ DUSK_SPAWN_MODE: "production" }), clock: fixedClock(1), taskRunner: recordingTaskRunner().runner },
    );
    expect(readTraces(prodRepo.dir).at(-1)!.raw_prompt).toBeUndefined();
    prodRepo.cleanup();
  });

  test("a known-shape secret in the prompt is redacted in the captured raw_prompt", async () => {
    repo.write(
      ".claude/agents/dusk-engineer.md",
      roleFile("engineer", { memory: "none", skills: [] }, "# E\nkey sk-ant-api03-LEAKED1234567890abcdefGHIJ here"),
    );
    await spawnSubAgent({ role: "engineer", sessionId: "s1", input: "x" }, deps());
    const trace = readTraces(repo.dir).at(-1)!;
    expect(trace.raw_prompt).toContain("<redacted:anthropic_api_key>");
    expect(trace.raw_prompt).not.toContain("sk-ant-");
  });
});

describe("2.6 — advisory skill scoping", () => {
  test("a skill outside the role frontmatter is not injected", async () => {
    const result = await spawnSubAgent({ role: "engineer", beadId: "bd_1", sessionId: "s1", input: "x" }, deps());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.assembledPrompt).not.toContain("SKILL-BODY-UNLISTED-SHOULD-NOT-APPEAR");
    expect(readTraces(repo.dir).at(-1)!.skills_loaded).not.toContain("dusk/engineer/unlisted-extra");
  });
});

describe("3.5 / P2-T3 — diagnosis is structurally invisible to the Verifier", () => {
  test("seeded diagnosis never appears in the Verifier raw_prompt; convergence flag only on bead-orchestrator", async () => {
    // Verifier spawn against the same bead.
    await spawnSubAgent(
      { role: "verifier", beadId: "bd_1", sessionId: "s1", input: "evaluate", intentPath: "notifications/send" },
      deps({ verifierFactory: makeScriptedVerdictFactory([cannedVerdict("notifications/send")]) }),
    );
    // Bead Orchestrator spawn against the same bead.
    await spawnSubAgent({ role: "bead-orchestrator", beadId: "bd_1", sessionId: "s1", input: "route" }, deps());

    const traces = readTraces(repo.dir);
    const verifierTrace = traces.find((t) => t.role === "verifier")!;
    const beadTrace = traces.find((t) => t.role === "bead-orchestrator")!;

    expect(verifierTrace.raw_prompt).not.toContain(SENTINEL_DIAGNOSIS);
    expect(verifierTrace.convergence_diagnosis_present).toBeUndefined();
    expect(beadTrace.convergence_diagnosis_present).toBe(true);
  });
});
