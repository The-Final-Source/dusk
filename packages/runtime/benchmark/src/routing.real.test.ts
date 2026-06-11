import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseDecorations } from "@dusk/core-decoration";
import { buildDerivedIndex } from "@dusk/core-index";
import { loadIntentTree } from "@dusk/core-graph";
import type { BoundSpawn, SubAgentTrace, VerifierFactory } from "@dusk/core-schema";
import { runTestRunner } from "@dusk/runtime-test-runner";
import { claudeCodeAvailable, claudeCodeModelClient } from "@dusk/runtime-verifier";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildSeededManifest, type SeededFixture } from "./fixtureManifest.js";
import { materializeFixtureProject } from "./fixtureProject.js";
import { realFixtureVerifierCall } from "./realAuditCall.js";
import { realTestPrepassFactory } from "./testPrepass.js";

/**
 * P5-T9 (real-model legs, correctness-gated): the verification class is
 * Verifier-caught (reported rate; the quantifier/implies/negative-polarity
 * cases included), and EVERY two-stage-test fixture is rejected by the
 * Verifier's test-body pre-pass with the Test Runner never invoked on it.
 */
const RUN_CORRECTNESS = Boolean(process.env.DUSK_RUN_CORRECTNESS) && claudeCodeAvailable();
const MODEL = process.env.DUSK_VERIFIER_MODEL ?? "claude-sonnet-4-6";
const TIMEOUT = 2 * 60 * 60 * 1000;

const stubTrace = (): SubAgentTrace => ({
  schema_version: 1,
  trace_id: `tr_${Math.floor(Math.random() * 1e9)}`,
  role: "verifier",
  invocation_site: "test-execution",
  model: MODEL,
  prompt_tokens: 0,
  completion_tokens: 0,
  latency_ms: 0,
  cost_usd: 0,
});

const spawnWith =
  (factory: VerifierFactory): BoundSpawn =>
  async (params) => {
    const verdict = await factory({
      intentPath: params.intentPath ?? "",
      sessionId: params.sessionId,
      beadId: params.beadId,
      assembledPrompt: params.input,
      input: params.input,
    });
    return { success: true, value: { trace: stubTrace(), assembledPrompt: params.input, verdict } };
  };

let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "dusk-routing-real-"));
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function loadFixtureProject(fixture: SeededFixture) {
  const projectDir = join(workDir, fixture.id.replaceAll("/", "__"));
  const { sourceFiles } = materializeFixtureProject(fixture, projectDir);
  const tree = loadIntentTree(join(projectDir, ".ia/intents"));
  const records = sourceFiles.flatMap((rel) => parseDecorations(readFileSync(join(projectDir, rel), "utf8"), rel));
  const index = buildDerivedIndex(records, tree.intents);
  const readFile = (file: string): string => {
    const full = join(projectDir, file);
    return existsSync(full) ? readFileSync(full, "utf8") : "";
  };
  return { projectDir, index, intents: tree.intents, readFile };
}

describe.skipIf(!RUN_CORRECTNESS)("P5-T9 — real-model routing legs", () => {
  it(
    "the verification class is Verifier-caught (reported), incl. the quantifier/implies/negative-polarity cases",
    async () => {
      const manifest = buildSeededManifest();
      expect(manifest.success).toBe(true);
      if (!manifest.success) return;
      const verification = manifest.value.fixtures.filter((f) => f.class === "verification" && f.ground_truth_outcome === "verifier_reject");
      const call = realFixtureVerifierCall({ workDir: join(workDir, "verification"), modelClient: claudeCodeModelClient({ model: MODEL }) });

      const decisions = new Map<string, "accept" | "reject">();
      for (const fixture of verification) {
        const result = await call(fixture, 0, { name: "standard" });
        decisions.set(fixture.id, result.decision);
      }

      // Correct routing: every verification fixture was evaluated by the
      // Verifier layer and its rate is REPORTED (the audit gates precision).
      expect(decisions.size).toBe(16);
      const caught = [...decisions.values()].filter((d) => d === "reject").length;
      const namedCases = [...decisions.keys()].filter((id) => /quantifier|implies|negative/.test(id));
      expect(namedCases.length).toBeGreaterThanOrEqual(9);
      // eslint-disable-next-line no-console
      console.log(`verification class Verifier-caught: ${caught}/16 (${[...decisions.entries()].filter(([, d]) => d === "accept").map(([id]) => id).join(", ") || "none missed"})`);
      expect(caught).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "every two-stage-test fixture is rejected by the test-body pre-pass with the Test Runner NEVER invoked",
    async () => {
      const manifest = buildSeededManifest();
      expect(manifest.success).toBe(true);
      if (!manifest.success) return;
      const twoStage = manifest.value.fixtures.filter((f) => f.class === "two-stage-test");
      expect(twoStage).toHaveLength(12);
      const modelClient = claudeCodeModelClient({ model: MODEL });

      for (const fixture of twoStage) {
        const { projectDir, index, intents, readFile } = loadFixtureProject(fixture);
        const vitestRunner = vi.fn(() => {
          throw new Error(`Test Runner invoked on ${fixture.id} — the pre-pass must catch it first`);
        });

        const result = await runTestRunner({
          spawn: spawnWith(realTestPrepassFactory({ index, intents, readFile, modelClient })),
          index,
          beadId: "bd_routing",
          sessionId: "routing",
          testIntentPath: "demo/feature/unit-tests",
          prepassInput: (claim) => `Does the test in ${claim.file} verify ${claim.coveredTriples.join(", ")}?`,
          cwd: projectDir,
          vitestRunner,
        });

        expect(result.success, `${fixture.id}: pre-pass errored`).toBe(true);
        if (!result.success) continue;
        expect(result.value.kind, `${fixture.id}: not rejected by the pre-pass`).toBe("reenter_step4");
        expect(vitestRunner).not.toHaveBeenCalled();
      }
    },
    TIMEOUT,
  );
});
