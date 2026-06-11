import { cpSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { readIntentFile } from "@dusk/core-parser";
import { TENSION_CLASSIFICATIONS } from "@dusk/core-schema";
import { readRuntimeEnv, spawnSubAgent, type TaskRunner } from "@dusk/runtime-orchestrator";
import { claudeCodeAvailable, claudeCodeModelClient } from "@dusk/runtime-verifier";
import { createTempRepo, isTransportError, readTraces, type TempRepo } from "@dusk/test-harness";

import { createAuthorRuntime, type AuthorRuntime } from "./runtime.js";
import { makeModelAuthorGenerator } from "./modelGenerator.js";
import { readDialogState } from "./dialogStore.js";

/**
 * Content-correctness legs for the 5-stage flow against the REAL frontier model
 * at temperature 0 through the ambient Claude Code CLI (no API key). Protocol:
 * N=3 independent runs per assertion, pass at ≥2/3 (P4-T2 / P4-T12 / P4-T4 /
 * P4-T5). Gated behind DUSK_RUN_CORRECTNESS=1 + CLI presence.
 */

const RUN_CORRECTNESS = Boolean(process.env.DUSK_RUN_CORRECTNESS) && claudeCodeAvailable();
const MODEL = process.env.DUSK_VERIFIER_MODEL ?? "claude-sonnet-4-6";
const N = 3;
const THRESHOLD = 2;

const here = dirname(fileURLToPath(import.meta.url));
const cliAssets = join(here, "..", "..", "..", "cli", "assets");

const CURSOR_PARENT = `schema_version: 2
id: api/pagination/cursor-only
description: List pagination is cursor-based; cursors are opaque tokens.
obligation: must
compose: all
triples:
  - id: cursor-param
    subject: list endpoints
    predicate: accept
    object: a single opaque cursor query parameter
`;

function makeRealRuntime(repo: TempRepo): AuthorRuntime {
  cpSync(join(cliAssets, "agents"), join(repo.dir, ".claude/agents"), { recursive: true });
  cpSync(join(cliAssets, "skills", "dusk"), join(repo.dir, ".claude/skills/dusk"), { recursive: true });
  const client = claudeCodeModelClient({ model: MODEL });
  const taskRunner: TaskRunner = async (call) => {
    // One retry on TRANSPORT-CLASSIFIED errors only (CLI timeout/exit, spawn
    // errno, malformed JSON envelope — see isTransportError). A transport throw
    // carries no model content, so the retry recovers a null observation;
    // anything else is a bug and propagates immediately.
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const completion = await client.complete({ system: "", user: call.prompt, temperature: 0 });
        return {
          output: completion.text,
          model: completion.usage.model,
          promptTokens: completion.usage.promptTokens,
          completionTokens: completion.usage.completionTokens,
          latencyMs: completion.usage.latencyMs,
          costUsd: completion.usage.costUsd,
        };
      } catch (error) {
        if (!isTransportError(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  };
  const clock = { now: () => Date.now() };
  return createAuthorRuntime({
    rootDir: repo.dir,
    clock,
    generator: makeModelAuthorGenerator({
      rootDir: repo.dir,
      sessionId: "real-flow",
      spawn: (params) => spawnSubAgent(params, { rootDir: repo.dir, env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }), clock, taskRunner }),
    }),
  });
}

const tracesText = (repo: TempRepo): string => JSON.stringify(readTraces(repo.dir));

/**
 * Per-attempt catch policy (protocol amendment, arch-board D4 + S7): ONLY a
 * transport-classified throw consumes one of the N attempts as a non-success
 * (it is a null observation, outside the content evidence). Everything else —
 * vitest assertion failures (deterministic invariants sit outside the 2/3
 * threshold) and programming bugs alike — fails the suite outright.
 */
const consumeOnlyTransport = (error: unknown): void => {
  if (!isTransportError(error)) throw error;
};

describe.skipIf(!RUN_CORRECTNESS)("author flow — real model (temperature 0, N=3 ≥2/3)", () => {
  test("3.3 / P4-T2 — Stage 2 surfaces the existing cursor intent via grep + classification; no vector substrate", async () => {
    let successes = 0;
    for (let i = 0; i < N; i += 1) {
      const repo = createTempRepo({ git: false, files: { ".ia/intents/api/pagination/cursor-only/intent.yaml": CURSOR_PARENT } });
      try {
        const runtime = makeRealRuntime(repo);
        const started = await runtime.start({ request: "author a new intent for cursor pagination token encoding on list endpoints" });
        if (!started.success) continue;
        const continued = await runtime.continue({ dialog_id: started.value.dialog_id, response: "yes, that framing is correct", payload: { kind: "confirm_framing" } });
        if (!continued.success) continue;
        const state = readDialogState(repo.dir, started.value.dialog_id);
        const surfaced = state.success ? (state.value.intents_drafted[0]?.tensions_surfaced ?? []) : [];
        const hit = surfaced.find((t) => t.target.includes("api/pagination/cursor-only"));
        const classified = hit !== undefined && (TENSION_CLASSIFICATIONS as readonly string[]).includes(hit.classification);
        // NO embedding/vector substrate is invoked: the only spawns are Author-role
        // model calls (the grep is an in-process file scan; RFC §8.10).
        const traces = readTraces(repo.dir);
        expect(traces.length).toBeGreaterThan(0);
        expect(traces.every((t) => t.role === "author")).toBe(true);
        if (classified) successes += 1;
      } catch (error) {
        consumeOnlyTransport(error); // only transport throws consume the attempt
      } finally {
        repo.cleanup();
      }
    }
    expect(successes).toBeGreaterThanOrEqual(THRESHOLD);
  }, 900_000);

  test("3.4 / P4-T12 — Stage 3 rejection takes the greenfield branch with no canonical-library lookup", async () => {
    let successes = 0;
    for (let i = 0; i < N; i += 1) {
      const repo = createTempRepo({ git: false });
      try {
        const runtime = makeRealRuntime(repo);
        const started = await runtime.start({ request: "author an intent: the notification service persists notifications before publishing them" });
        if (!started.success) continue;
        const id = started.value.dialog_id;
        const afterFraming = await runtime.continue({ dialog_id: id, response: "yes", payload: { kind: "confirm_framing" } });
        if (!afterFraming.success) continue;
        // Empty intent tree → zero tensions → the runtime lands at Stage 3 with a proposal.
        if (!("stage" in afterFraming.value) || afterFraming.value.stage !== 3) {
          await runtime.continue({ dialog_id: id, response: "no tensions to resolve" });
        }
        const rejected = await runtime.continue({ dialog_id: id, response: "no — reject the proposal, draft from my framing only", payload: { kind: "reject_practice_proposal" } });
        if (!rejected.success) continue;
        const state = readDialogState(repo.dir, id);
        const greenfield =
          state.success &&
          state.value.current_stage === 4 &&
          state.value.intents_drafted.every((d) => d.practice_scaffold === undefined);
        // No canonical-library lookup: prompts never reference the canonical tree.
        expect(tracesText(repo)).not.toContain("packages/intents/canonical");
        if (greenfield) successes += 1;
      } catch (error) {
        consumeOnlyTransport(error); // only transport throws consume the attempt
      } finally {
        repo.cleanup();
      }
    }
    expect(successes).toBeGreaterThanOrEqual(THRESHOLD);
  }, 900_000);

  test("3.7 / P4-T4 — 'must NOT use offset pagination' is drafted affirmative + polarity: negative and commits", async () => {
    let successes = 0;
    for (let i = 0; i < N; i += 1) {
      const repo = createTempRepo({ git: false });
      const runtime = makeRealRuntime(repo);
      const ok = await driveToCommit(runtime, repo, "list endpoints must not use offset pagination");
      if (ok) {
        const created = findCreated(repo);
        const intent = created
          .map((p) => readIntentFile(join(repo.dir, ".ia/intents", p, "intent.yaml")))
          .find((r) => r.success && r.intent.triples?.some((t) => t.polarity === "negative"));
        const negative = intent?.success === true;
        const noNegatedPredicate =
          intent?.success === true && intent.intent.triples!.every((t) => !/\b(not|never|lacks|avoid)\b/i.test(t.predicate));
        if (negative && noNegatedPredicate) successes += 1;
      }
      repo.cleanup();
    }
    expect(successes).toBeGreaterThanOrEqual(THRESHOLD);
  }, 900_000);

  test("3.8 / P4-T5 — a conditional request commits as compose: implies with a closed-vocabulary antecedent", async () => {
    let successes = 0;
    for (let i = 0; i < N; i += 1) {
      const repo = createTempRepo({ git: false });
      const runtime = makeRealRuntime(repo);
      const ok = await driveToCommit(runtime, repo, "if an endpoint is decorated api/write-endpoint, it must validate an idempotency key");
      if (ok) {
        const created = findCreated(repo);
        const implied = created
          .map((p) => readIntentFile(join(repo.dir, ".ia/intents", p, "intent.yaml")))
          .find((r) => r.success && r.intent.compose === "implies");
        const valid =
          implied?.success === true &&
          implied.intent.antecedent!.every((a) => ["is decorated with", "claims any aspect of", "is enclosed by a decoration of"].includes(a.predicate)) &&
          implied.intent.consequent!.length > 0;
        if (valid) successes += 1;
      }
      repo.cleanup();
    }
    expect(successes).toBeGreaterThanOrEqual(THRESHOLD);
  }, 900_000);
});

/** Drive a full dialog to finalize; returns true when intents committed.
 *  Transport throws return false (the attempt is consumed, per protocol). */
async function driveToCommit(runtime: AuthorRuntime, repo: TempRepo, request: string): Promise<boolean> {
  try {
    return await driveToCommitInner(runtime, repo, request);
  } catch (error) {
    if (!isTransportError(error)) throw error; // bugs fail loudly; transport consumes the attempt
    return false;
  }
}

async function driveToCommitInner(runtime: AuthorRuntime, repo: TempRepo, request: string): Promise<boolean> {
  const started = await runtime.start({ request });
  if (!started.success) return false;
  const id = started.value.dialog_id;
  let result = await runtime.continue({ dialog_id: id, response: "yes, that framing is correct", payload: { kind: "confirm_framing" } });
  // Walk forward: resolve tensions if asked, accept the practice proposal, skip layers, confirm.
  for (let turn = 0; turn < 8; turn += 1) {
    if (!result.success) return false;
    if ("finalize_ready" in result.value) break;
    const stage = result.value.stage;
    if (stage === 2) {
      result = await runtime.continue({ dialog_id: id, response: "fold the new behavior into the most specific existing intent" });
    } else if (stage === 3) {
      result = await runtime.continue({ dialog_id: id, response: "accept", payload: { kind: "accept_practice_proposal" } });
    } else if (stage === 4 || stage === "4.5") {
      const state = readDialogState(repo.dir, id);
      const picked = state.success && state.value.intents_drafted.some((d) => d.pyramid_picked !== undefined);
      result = picked
        ? await runtime.continue({ dialog_id: id, response: "confirm", payload: { kind: "confirm_draft" } })
        : await runtime.continue({ dialog_id: id, response: "no test children needed", payload: { layers: [] } });
    } else {
      return false;
    }
  }
  if (!result.success || !("finalize_ready" in result.value)) return false;
  const finalized = await runtime.finalize({ dialog_id: id });
  return finalized.success;
}

/** Enumerate intent paths created under .ia/intents (committed by finalize). */
function findCreated(repo: TempRepo): string[] {
  const root = join(repo.dir, ".ia/intents");
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      else if (entry.name === "intent.yaml" && rel) out.push(rel);
    }
  };
  walk(root, "");
  return out;
}
