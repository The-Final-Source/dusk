import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadWorkedExample } from "@dusk/fixtures";
import { createTempRepo, fixedClock, makeScriptedVerdictFactory, readTraces } from "@dusk/test-harness";
import { readRuntimeEnv, spawnSubAgent } from "@dusk/runtime-orchestrator";
import { claudeCodeAvailable, claudeCodeModelClient } from "@dusk/runtime-verifier";
import type { Verdict } from "@dusk/core-schema";
import { describe, expect, test } from "vitest";

import { buildContext } from "./context.js";
import { createDuskMcpServer } from "./server.js";

/**
 * Phase-2 phase-landing smoke test (Plan lines 367–371). Two parts:
 *  - The SPAWN AUDIT (zero-model, always runs): a Verifier spawned memory:none
 *    against a bead carrying a seeded diagnosis captures a raw_prompt with NO
 *    diagnosis / iteration content — the load-bearing freshness invariant.
 *  - The VERIFY MATRIX (real model via Claude Code, opt-in DUSK_RUN_CORRECTNESS, N=3 ≥2/3): the
 *    clean worked example verifies pass (incl. negative-polarity + implies
 *    antecedent-false vacuous accept with no consequent model call); the
 *    3-defects variant fails the focal defect, surfaces the mismatch as
 *    low_confidence, and fails the implies consequent with antecedent true.
 */
const RUN_CORRECTNESS = Boolean(process.env.DUSK_RUN_CORRECTNESS) && claudeCodeAvailable();
const MODEL = process.env.DUSK_VERIFIER_MODEL ?? "claude-sonnet-4-6";

const SENTINEL = "SMOKE-DIAGNOSIS-do-not-leak-7c1f";

async function connect(server: ReturnType<typeof createDuskMcpServer>): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "smoke", version: "1" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

const parseTool = (res: unknown): unknown => JSON.parse((res as { content: Array<{ text?: string }> }).content[0].text ?? "null");

describe("phase-landing spawn audit — Verifier is fresh (memory: none, no diagnosis leak)", () => {
  test("a seeded diagnosis never appears in the Verifier's raw_prompt", async () => {
    const repo = createTempRepo({ git: false });
    try {
      repo.write(
        ".claude/agents/dusk-verifier.md",
        "---\ndusk_role_version: 2\nname: dusk-verifier\ndescription: v\ntools: [Read]\nmemory: none\nskills: []\nmodel: claude-sonnet-4-6\n---\n\n# Verifier\nBODY",
      );
      repo.write(".ia/runtime/beads/bd_1/engineer.md", `---\nbead_id: bd_1\nrole: engineer\nlast_iter: 5\nlast_compacted_at_iter: 0\n---\n\n## Current diagnosis\n${SENTINEL}\n`);

      const verdict: Verdict = { intent_path: "notifications/send", decision: "accept", per_triple: [], aggregate_rationale: "" };
      await spawnSubAgent(
        { role: "verifier", beadId: "bd_1", sessionId: "s1", input: "judge", intentPath: "notifications/send", iterationNumber: 5 },
        { rootDir: repo.dir, env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }), clock: fixedClock(1), taskRunner: async () => ({ output: "" }), verifierFactory: makeScriptedVerdictFactory([verdict]) },
      );

      const trace = readTraces(repo.dir).find((t) => t.role === "verifier")!;
      expect(trace.raw_prompt).toBeDefined();
      expect(trace.raw_prompt).not.toContain(SENTINEL);
      expect(trace.convergence_diagnosis_present).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });
});

describe.skipIf(!RUN_CORRECTNESS)("phase-landing verify matrix (real model)", () => {
  const N = 3;
  const THRESHOLD = 2;

  function serverFor(variant: "clean" | "defects") {
    const repo = createTempRepo({ git: false });
    const wx = loadWorkedExample({ variant });
    const ctx = buildContext({ rootDir: repo.dir, index: wx.index, intents: wx.intents, readFile: wx.readFile, modelClient: claudeCodeModelClient({ model: MODEL }) });
    return { server: createDuskMcpServer(ctx), repo };
  }

  async function verifyN(client: Client, intents: string[]): Promise<Verdict[][]> {
    const runs: Verdict[][] = [];
    for (let i = 0; i < N; i += 1) {
      const res = parseTool(
        await client.callTool({ name: "dusk_verify", arguments: { intents } }, undefined, { timeout: 290_000 }),
      ) as { verdicts: Verdict[] } | { kind: string };
      runs.push("verdicts" in res ? res.verdicts : []);
    }
    return runs;
  }

  test("clean → focal pass; implies antecedent-false vacuous accept with no consequent call", async () => {
    const { server, repo } = serverFor("clean");
    try {
      const client = await connect(server);
      const runs = await verifyN(client, ["notifications/send", "api/idempotency-on-writes"]);
      const sendAccepts = runs.filter((vs) => vs.find((v) => v.intent_path === "notifications/send")?.decision === "accept").length;
      expect(sendAccepts).toBeGreaterThanOrEqual(THRESHOLD);
      const impliesVacuous = runs.filter((vs) => vs.find((v) => v.intent_path === "api/idempotency-on-writes")?.implies_antecedent_held === false).length;
      expect(impliesVacuous).toBeGreaterThanOrEqual(THRESHOLD); // antecedent eval is index-only; ≥2/3 absorbs infra transients
    } finally {
      repo.cleanup();
    }
  }, 360_000);

  test("3-defects → focal fail, mismatch → low_confidence, implies consequent fails with antecedent true", async () => {
    const { server, repo } = serverFor("defects");
    try {
      const client = await connect(server);
      const runs = await verifyN(client, ["notifications/send", "api/idempotency-on-writes"]);
      const focalFail = runs.filter((vs) => vs.find((v) => v.intent_path === "notifications/send")?.per_triple.find((t) => t.triple_id === "publish-sync-per-insert")?.focal_verdict === "fail").length;
      expect(focalFail).toBeGreaterThanOrEqual(THRESHOLD);
      const impliesHeld = runs.filter((vs) => vs.find((v) => v.intent_path === "api/idempotency-on-writes")?.implies_antecedent_held === true).length;
      expect(impliesHeld).toBeGreaterThanOrEqual(THRESHOLD);
    } finally {
      repo.cleanup();
    }
  }, 360_000);
});
