import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import { loadIntentTree } from "@dusk/core-graph";
import { readIntentFile } from "@dusk/core-parser";
import { DuskConfigSchema } from "@dusk/core-schema";
import {
  CURSOR_DECODE_YAML,
  CURSOR_PARENT_YAML,
  UNAUTHORED_INTENT_REQUEST,
  UNAUTHORED_INTENT_SCOPE,
} from "@dusk/fixtures";
import { createAuthorRuntime, makeModelAuthorGenerator, readDialogState, type AuthorRuntime } from "@dusk/runtime-author";
import { clearSnapshot, readRuntimeEnv, runImplement, spawnSubAgent, type RunImplementDeps, type TaskRunner } from "@dusk/runtime-orchestrator";
import { claudeCodeAvailable, claudeCodeModelClient } from "@dusk/runtime-verifier";
import { createMockGitWorktree, makeScriptedVerdictFactory, makeVitestJsonReportString, type MockGitWorktree } from "@dusk/test-harness";
import { describe, expect, test } from "vitest";

/**
 * 10.3 Primary — the Phase-4 phase-landing smoke: "author then resume,
 * including a conditional intent". REAL frontier model (ambient Claude Code
 * CLI, temperature 0) for the authoring content + real fs + real git for the
 * pipeline (scripted-verdict double on the Verifier legs, per the Phase-3
 * smoke convention). Protocol: N=3 full loops, pass at ≥2/3.
 */

const RUN_CORRECTNESS = Boolean(process.env.DUSK_RUN_CORRECTNESS) && claudeCodeAvailable();
const MODEL = process.env.DUSK_VERIFIER_MODEL ?? "claude-sonnet-4-6";
const N = 3;
const THRESHOLD = 2;

const here = dirname(fileURLToPath(import.meta.url));
const cliAssets = join(here, "..", "..", "..", "cli", "assets");

const PRIMARY_REQUEST = `${UNAUTHORED_INTENT_REQUEST}. The encode function must NEVER emit an offset-based fallback token. Also author a conditional companion intent: if an endpoint is decorated api/pagination/cursor-only, it must sign its cursor tokens.`;

const role = (slug: string, memory: string): string =>
  ["---", "dusk_role_version: 2", `name: dusk-${slug}`, "description: t", "tools: [Read, Edit]", `memory: ${memory}`, "skills: []", "model: claude-sonnet-4-6", "---", "", `# ${slug}`, ""].join("\n");

function buildRealAuthorRuntime(repoDir: string): AuthorRuntime {
  const client = claudeCodeModelClient({ model: MODEL });
  const taskRunner: TaskRunner = async (call) => {
    // One retry on ANY thrown completion error — a throw carries no model
    // content by construction, so a retry recovers a null observation only.
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const completion = await client.complete({ system: "", user: call.prompt, temperature: 0 });
        return { output: completion.text, model: completion.usage.model, promptTokens: completion.usage.promptTokens, completionTokens: completion.usage.completionTokens, latencyMs: completion.usage.latencyMs, costUsd: completion.usage.costUsd };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };
  const clock = { now: () => Date.now() };
  return createAuthorRuntime({
    rootDir: repoDir,
    clock,
    generator: makeModelAuthorGenerator({
      rootDir: repoDir,
      sessionId: `p4-primary-${Date.now()}`,
      spawn: (params) => spawnSubAgent(params, { rootDir: repoDir, env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }), clock, taskRunner }),
    }),
  });
}

async function runPrimaryOnce(iteration: number): Promise<boolean> {
  const session = `p4-primary-${iteration}`;
  const resumeSession = `${session}-resume`;
  clearSnapshot(session);
  clearSnapshot(resumeSession);
  const mg: MockGitWorktree = createMockGitWorktree({ idBase: `2026061015000${iteration}` });
  try {
    mkdirSync(join(mg.repoDir, ".claude/agents"), { recursive: true });
    for (const [slug, memory] of [["engineer", "bead"], ["verifier", "none"], ["bead", "bead"], ["test-runner", "bead"]] as const) {
      writeFileSync(join(mg.repoDir, ".claude/agents", `dusk-${slug}.md`), role(slug, memory));
    }
    // The Author role file + seven skills (the real spawn loads them).
    cpSync(join(cliAssets, "agents", "dusk-author.md"), join(mg.repoDir, ".claude/agents/dusk-author.md"));
    cpSync(join(cliAssets, "skills", "dusk"), join(mg.repoDir, ".claude/skills/dusk"), { recursive: true });
    const seed = (rel: string, content: string): void => {
      mkdirSync(dirname(join(mg.repoDir, rel)), { recursive: true });
      writeFileSync(join(mg.repoDir, rel), content, "utf8");
    };
    seed(".ia/intents/api/pagination/cursor-only/intent.yaml", CURSOR_PARENT_YAML);
    seed(".ia/intents/api/pagination/cursor-only/cursor-decode/intent.yaml", CURSOR_DECODE_YAML);

    const diskIndex = (): DerivedIndex => buildDerivedIndex([], loadIntentTree(join(mg.repoDir, ".ia/intents")).intents);
    const implementDeps = (sessionId: string, clockMs: number): RunImplementDeps => ({
      rootDir: mg.repoDir,
      sessionId,
      env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }),
      taskRunner: async () => ({ output: "ok", model: MODEL, promptTokens: 1, completionTokens: 1, costUsd: 0, latencyMs: 1 }),
      verifierFactory: makeScriptedVerdictFactory((ctx) => ({ intent_path: ctx.intentPath, decision: "accept", per_triple: [], aggregate_rationale: "ok" })),
      buildIndex: diskIndex,
      clock: { now: () => clockMs },
      config: DuskConfigSchema.parse({}),
      perEntryMax: 20,
      lifetimeMax: 40,
      vitestRunner: (files) => makeVitestJsonReportString(files.map((f) => ({ file: f, title: "t", status: "passed" as const, duration: 1 }))),
    });

    // ---- 1. Pause for authoring with the enriched seed. ----
    const paused = await runImplement({ request: PRIMARY_REQUEST, scopeHint: [...UNAUTHORED_INTENT_SCOPE] }, implementDeps(session, 1_000));
    if (paused.success || paused.error.kind !== "implement_paused_for_authoring") return false;
    const token = paused.error.details?.resume_token as string;
    const seedPrompt = paused.error.details?.suggested_dialog_seed as string;

    // ---- 2. Drive the REAL 5-stage flow. ----
    const runtime = buildRealAuthorRuntime(mg.repoDir);
    const started = await runtime.start({ request: `${seedPrompt}\n\nFull request: ${PRIMARY_REQUEST}` });
    if (!started.success) return false;
    const id = started.value.dialog_id;

    // Confirm framing → Stage 2 discovery (grep finds the parent) → resolve the
    // tension → accept the practice proposal → pick the unit-tests layer → confirm.
    let result = await runtime.continue({ dialog_id: id, response: "yes, that framing is correct", payload: { kind: "confirm_framing" } });
    for (let turn = 0; turn < 10; turn += 1) {
      if (!result.success) return false;
      if ("finalize_ready" in result.value) break;
      const stage = result.value.stage;
      if (stage === 1) {
        result = await runtime.continue({ dialog_id: id, response: "yes, proceed", payload: { kind: "confirm_framing" } });
      } else if (stage === 2) {
        result = await runtime.continue({ dialog_id: id, response: "extend the existing cursor-only parent — author the encode leaf under its path" });
      } else if (stage === 3) {
        result = await runtime.continue({ dialog_id: id, response: "accept the proposal", payload: { kind: "accept_practice_proposal" } });
      } else {
        const state = readDialogState(mg.repoDir, id);
        const picked = state.success && state.value.intents_drafted.some((d) => d.pyramid_picked !== undefined);
        result = picked
          ? await runtime.continue({ dialog_id: id, response: "confirm", payload: { kind: "confirm_draft" } })
          : await runtime.continue({ dialog_id: id, response: "unit tests only", payload: { layers: ["unit-tests"] } });
      }
    }
    if (!result.success || !("finalize_ready" in result.value)) return false;
    const finalized = await runtime.finalize({ dialog_id: id });
    if (!finalized.success) return false;

    // ---- 3. Content assertions: negative-polarity triple, unit-tests child, implies intent. ----
    const created = finalized.value.intents_created;
    const loadedAll = created.map((p) => readIntentFile(join(mg.repoDir, ".ia/intents", p, "intent.yaml")));
    if (!loadedAll.every((r) => r.success)) return false; // immediately resolvable, schema-valid v2
    const intents = loadedAll.map((r) => (r.success ? r.intent : null)!);
    const hasNegative = intents.some((i) => (i.triples ?? []).some((t) => t.polarity === "negative"));
    const hasUnitChild = created.some((p) => p.endsWith("/unit-tests"));
    const implied = intents.find((i) => i.compose === "implies");
    const hasValidConditional =
      implied !== undefined &&
      (implied.antecedent ?? []).every((a) => ["is decorated with", "claims any aspect of", "is enclosed by a decoration of"].includes(a.predicate));
    if (!hasNegative || !hasUnitChild || !hasValidConditional) return false;

    // ---- 4. Resume the paused pipeline → Steps 1–9 complete with commits; checkpoint consumed. ----
    const resumed = await runImplement({ resumeToken: token }, implementDeps(resumeSession, 2_000));
    if (!resumed.success || resumed.value.commits.length < 1) return false;
    const again = await runImplement({ resumeToken: token }, implementDeps(resumeSession, 3_000));
    return !again.success && again.error.kind === "implement_resume_token_expired";
  } catch (error) {
    // Transport throws consume the attempt (null observation); a vitest
    // assertion failure is a deterministic invariant violation — fail outright.
    if (error instanceof Error && error.name === "AssertionError") throw error;
    return false;
  } finally {
    clearSnapshot(session);
    clearSnapshot(resumeSession);
    mg.cleanup();
  }
}

describe.skipIf(!RUN_CORRECTNESS)("10.3 Primary — author then resume, including a conditional intent (real model, N=3 ≥2/3)", () => {
  test("pause → real 5-stage authoring (negative polarity + pyramid child + implies) → finalize → resume → commit", async () => {
    let successes = 0;
    for (let i = 0; i < N && successes < THRESHOLD; i += 1) {
      if (await runPrimaryOnce(i)) successes += 1;
    }
    expect(successes).toBeGreaterThanOrEqual(THRESHOLD);
  }, 2_700_000);
});
