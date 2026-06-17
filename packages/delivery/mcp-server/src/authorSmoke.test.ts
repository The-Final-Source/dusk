import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";
import { loadIntentTree } from "@dusk/core-graph";
import { readIntentFile } from "@dusk/core-parser";
import { DuskConfigSchema, type DraftIntent, type ScriptedAuthorResponse, type TestVerifierLivelockReport, type VerifierFactory } from "@dusk/core-schema";
import { createAuthorRuntime, type AuthorRuntime } from "@dusk/runtime-author";
import { runRecoveryLadder } from "@dusk/runtime-recovery-ladder";
import { clearSnapshot, readRuntimeEnv, runImplement, type RunImplementDeps } from "@dusk/runtime-orchestrator";
import {
  createMockGitWorktree,
  fixedClock,
  makeScriptedAuthorGenerator,
  makeScriptedVerdictFactory,
  makeDuskTestCapture,
  manualClock,
  type MockGitWorktree,
} from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { duskResolveLivelock, type WriteSurfaceDeps } from "./writeSurface.js";

/**
 * §5.4 (P4-T8 cross-tool mechanics) + §6.3 (smoke Variant B) — the
 * `dusk_implement` ↔ `dusk_author` loop closes, zero-model via the scripted
 * Author driver + scripted-verdict double, against real fs + real git.
 */

const role = (slug: string, memory: string): string =>
  ["---", "dusk_role_version: 2", `name: dusk-${slug}`, "description: t", "tools: [Read, Edit]", `memory: ${memory}`, "skills: []", "model: claude-sonnet-4-6", "---", "", `# ${slug}`, ""].join("\n");

const PARENT_INTENT = `schema_version: 2
id: api/pagination/cursor-only
description: List pagination is cursor-based; cursors are opaque tokens.
obligation: must
compose: all
triples:
  - id: cursor-param
    subject: list endpoints
    predicate: accept
    object: a single opaque cursor query parameter
relates_to:
  - kind: implies
    target: api/pagination/cursor-only/cursor-encode
`;

const SIBLING_INTENT = `schema_version: 2
id: api/pagination/cursor-only/cursor-decode
description: Cursor decoding validates input and produces a typed state.
obligation: must
compose: all
triples:
  - id: query-param
    subject: the cursor decode function
    predicate: accept
    object: a single string query parameter named cursor
`;

const WIDGET_INTENT = `schema_version: 2
id: api/widget
description: The widget endpoint returns raw widgets.
obligation: must
compose: all
triples:
  - id: shape
    subject: the widget endpoint
    predicate: return
    object: a raw widget blob
`;

const ENCODE_DRAFT: DraftIntent = {
  id: "api/pagination/cursor-only/cursor-encode",
  description: "Cursor encoding produces an opaque token from a typed state.",
  obligation: "must",
  triples: [{ id: "opaque-token", subject: "the cursor encode function", predicate: "produce", object: "an opaque base64url cursor token", polarity: "positive" }],
};

const REFINED_WIDGET: DraftIntent = {
  id: "api/widget",
  description: "The widget endpoint returns a typed, serialized widget.",
  obligation: "must",
  triples: [{ id: "shape", subject: "the widget endpoint", predicate: "return", object: "a typed serialized widget", polarity: "positive" }],
};

let mg: MockGitWorktree;
let seq = 0;
const SESSIONS = ["p4-smoke", "p4-smoke-resume", "p4-l2", "p4-l2-retry", "p4-livelock", "p4-livelock-resume"];
beforeEach(() => {
  for (const s of SESSIONS) clearSnapshot(s);
  mg = createMockGitWorktree({ idBase: `2026061014000${seq++}` });
  mkdirSync(join(mg.repoDir, ".claude/agents"), { recursive: true });
  for (const [slug, memory] of [["engineer", "bead"], ["verifier", "none"], ["bead", "bead"], ["test-runner", "bead"]] as const) {
    writeFileSync(join(mg.repoDir, ".claude/agents", `dusk-${slug}.md`), role(slug, memory));
  }
});
afterEach(() => {
  for (const s of SESSIONS) clearSnapshot(s);
  mg.cleanup();
});

const seedFile = (rel: string, content: string): void => {
  const full = join(mg.repoDir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
};

const diskIndex = (): DerivedIndex => buildDerivedIndex([], loadIntentTree(join(mg.repoDir, ".ia/intents")).intents);

const implementDeps = (sessionId: string, over: Partial<RunImplementDeps> = {}): RunImplementDeps => ({
  rootDir: mg.repoDir,
  sessionId,
  env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }),
  taskRunner: async () => ({ output: "ok", model: "claude-sonnet-4-6", promptTokens: 1, completionTokens: 1, costUsd: 0, latencyMs: 1 }),
  verifierFactory: makeScriptedVerdictFactory((ctx) => ({ intent_path: ctx.intentPath, decision: "accept", per_triple: [], aggregate_rationale: "ok" })),
  buildIndex: diskIndex,
  clock: fixedClock(1_000),
  config: DuskConfigSchema.parse({}),
  perEntryMax: 20,
  lifetimeMax: 40,
  vitestRunner: (files) => makeDuskTestCapture(files.map((f) => ({ file: f, title: "t", status: "passed" as const, duration: 1 }))),
  ...over,
});

const authorRuntime = (script: ScriptedAuthorResponse[]): AuthorRuntime =>
  createAuthorRuntime({ rootDir: mg.repoDir, clock: manualClock(Date.UTC(2026, 5, 10, 14, 0, 0)), generator: makeScriptedAuthorGenerator(script) });

describe("5.4 / P4-T8 — pause → drive the REAL Author flow → resume completes (mechanics, zero-model)", () => {
  test("the dusk_implement ↔ dusk_author loop closes against one repo", async () => {
    seedFile(".ia/intents/api/pagination/cursor-only/intent.yaml", PARENT_INTENT);
    seedFile(".ia/intents/api/pagination/cursor-only/cursor-decode/intent.yaml", SIBLING_INTENT);

    // 1 — pause with the ENRICHED seed (the Sprint-5 stub is gone).
    const paused = await runImplement(
      { request: "add cursor encoding for paginated lists", scopeHint: ["api/pagination/cursor-only"] },
      implementDeps("p4-smoke"),
    );
    expect(paused.success).toBe(false);
    if (paused.success) return;
    expect(paused.error.kind).toBe("implement_paused_for_authoring");
    const token = paused.error.details?.resume_token as string;
    const seed = paused.error.details?.suggested_dialog_seed as string;
    expect(seed).toContain("cursors are opaque tokens");
    expect(seed).toContain("cursor decode");
    expect(seed).not.toBe("api/pagination/cursor-only/cursor-encode");

    // 2 — drive the REAL Author flow (scripted generator), seeded by the checkpoint's framing.
    const runtime = authorRuntime([
      { expectStage: 1, question: `Framing from seed: ${seed.slice(0, 60)}… Confirm?` },
      { expectStage: 2, question: "One overlap found.", tensions: [{ target: "api/pagination/cursor-only", classification: "overlap", resolution_options: ["extend the parent"] }] },
      { expectStage: 3, question: "Practice: opaque base64url tokens. Accept?", practiceProposal: "Encode produces opaque base64url tokens; round-trips with decode." },
      { expectStage: 4, question: "Drafted cursor-encode. Pick layers.", draftPatch: ENCODE_DRAFT },
    ]);
    const started = await runtime.start({ request: seed });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;
    await runtime.continue({ dialog_id: id, response: "yes that framing is correct" });
    await runtime.continue({ dialog_id: id, response: "extend the parent", payload: { resolutions: [{ target: "api/pagination/cursor-only", resolution: "extend the parent" }] } });
    await runtime.continue({ dialog_id: id, response: "accept" });
    await runtime.continue({ dialog_id: id, response: "none", payload: { layers: [] } });
    const ready = await runtime.continue({ dialog_id: id, response: "confirm" });
    if (!ready.success) throw new Error("confirm failed");
    expect(ready.value).toEqual({ finalize_ready: true });
    const finalized = await runtime.finalize({ dialog_id: id });
    if (!finalized.success) throw new Error("finalize failed");
    expect(finalized.value.intents_created).toEqual(["api/pagination/cursor-only/cursor-encode"]);
    // Authored intent is immediately resolvable on disk.
    expect(readIntentFile(join(mg.repoDir, ".ia/intents/api/pagination/cursor-only/cursor-encode/intent.yaml")).success).toBe(true);

    // 3 — resume the paused pipeline: the Decomposer re-runs and now resolves the ref.
    const resumed = await runImplement({ resumeToken: token }, implementDeps("p4-smoke-resume"));
    expect(resumed.success).toBe(true);
    if (!resumed.success) return;
    expect(resumed.value.commits.length).toBeGreaterThanOrEqual(1);

    // 4 — checkpoint consumed on the Step-1 transition (single-use preserved).
    const again = await runImplement({ resumeToken: token }, implementDeps("p4-smoke-resume", { rebuildIndex: true }));
    expect(again.success).toBe(false);
    if (again.success) return;
    expect(again.error.kind).toBe("implement_resume_token_expired");
  }, 60_000);
});

describe("6.3 / smoke Variant B — L2 error → l2_recovery dialog → refined intent → re-invoke completes", () => {
  test("the L2 recovery loop closes end-to-end", async () => {
    seedFile(".ia/intents/api/widget/intent.yaml", WIDGET_INTENT);

    // 1 — drive the bead to L2 exhaustion (zero satisfiable): proposal + recoverable error.
    const beadId = mg.nextBeadId();
    const ladder = runRecoveryLadder({
      rootDir: mg.repoDir,
      beadId,
      worktreePath: mg.repoDir,
      satisfiedIntents: [],
      deferredIntents: ["api/widget"],
      diagnosisHistory: [{ iter: 3, text: "the raw-blob shape claim is unsatisfiable as phrased" }],
      lastVerdicts: [],
      beadMemory: "",
      trailers: { intents: [{ intent_path: "api/widget", aspect_ids: ["shape"] }], test_intents: [], bead_id: beadId, verdict_id: "vd", trace_id: "tr", verifier_model: "m", long_cycle_samples: 10, test_suites_passed: 0 },
      subject: "x",
    });
    expect(ladder.success).toBe(true);
    if (!ladder.success || ladder.value.level !== "L2") throw new Error("expected L2");
    expect(ladder.value.error.kind).toBe("bead_intent_revision_needed");
    const proposalPath = ladder.value.proposalPath;

    // 2 — the user consumes intent-proposal.yaml via the l2_recovery entry mode (Stage-3 injection).
    const runtime = authorRuntime([{ expectStage: 4, question: "Refined the widget intent per the proposal. Pick layers.", draftPatch: REFINED_WIDGET }]);
    const started = await runtime.start({ request: "revise api/widget per the recovery proposal", entry_mode: "l2_recovery", dialog_init: { proposal_path: proposalPath } });
    expect(started.success).toBe(true);
    if (!started.success) return;
    expect(started.value.stage).toBe(3);
    expect(started.value.next_question).toContain("api/widget");
    const id = started.value.dialog_id;

    const accepted = await runtime.continue({ dialog_id: id, response: "accept" });
    if (!accepted.success) throw new Error("accept failed");
    expect(accepted.value).toMatchObject({ stage: 4 });
    await runtime.continue({ dialog_id: id, response: "none", payload: { layers: [] } });
    const ready = await runtime.continue({ dialog_id: id, response: "confirm" });
    if (!ready.success) throw new Error("confirm failed");
    expect(ready.value).toEqual({ finalize_ready: true });
    const finalized = await runtime.finalize({ dialog_id: id });
    expect(finalized.success).toBe(true);
    if (!finalized.success) return;
    expect(finalized.value.intents_created).toEqual(["api/widget"]);

    // 3 — the refined intent is committed to .ia/intents/<path>/intent.yaml.
    const reloaded = readIntentFile(join(mg.repoDir, ".ia/intents/api/widget/intent.yaml"), "api/widget");
    expect(reloaded.success).toBe(true);
    if (!reloaded.success) return;
    expect(reloaded.intent.triples?.[0].object).toBe("a typed serialized widget");

    // 4 — the user re-invokes dusk_implement (no auto-restore) and the bead completes.
    const retried = await runImplement({ request: "implement the widget endpoint", scopeHint: ["api/widget"] }, implementDeps("p4-l2-retry"));
    expect(retried.success).toBe(true);
    if (!retried.success) return;
    expect(retried.value.commits.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe("7.4 — livelock → modify_triple dialog → finalize → resume sees the refreshed intent", () => {
  const SEND_INTENT = `schema_version: 2
id: notifications/send
description: The send service persists notifications before publishing.
obligation: must
compose: all
triples:
  - id: persist-first
    subject: the send service
    predicate: persist
    object: the notification before publishing
`;
  const SEND_TESTS_INTENT = `schema_version: 2
id: notifications/send/unit-tests
description: Unit tests cover the persist-before-publish ordering.
obligation: must
compose: all
triples:
  - id: covers-persist-first
    subject: the unit test
    predicate: verifies
    object: the persist call order via a mock spy
`;
  const focal = (file: string, line: number, marker: DecorationRecord["marker"], intentPath: string, aspects: string[]): DecorationRecord => ({
    file,
    line,
    scope: "declaration",
    declaration_name: "d",
    marker,
    intent_path: intentPath,
    aspect_ids: aspects,
    support_triple: null,
    ignore_clause: null,
  });

  test("the bead re-run's Verifier spawns see the refreshed triple; the run completes", async () => {
    seedFile(".ia/intents/notifications/send/intent.yaml", SEND_INTENT);
    seedFile(".ia/intents/notifications/send/unit-tests/intent.yaml", SEND_TESTS_INTENT);

    const decoratedIndex = (): DerivedIndex =>
      buildDerivedIndex(
        [
          focal("src/n.ts", 1, "intent", "notifications/send", ["persist-first"]),
          focal("src/n.test.ts", 1, "intent-test", "notifications/send/unit-tests", ["covers-persist-first"]),
        ],
        loadIntentTree(join(mg.repoDir, ".ia/intents")).intents,
      );

    // 1 — drive into livelock: the double rejects the test pre-pass with a
    //     predicate-concentrated rationale on every re-entry.
    const livelockFactory: VerifierFactory = makeScriptedVerdictFactory((ctx) =>
      ctx.assembledPrompt.includes("Does the test")
        ? { intent_path: ctx.intentPath, decision: "reject", per_triple: [], aggregate_rationale: "the test does not constrain the predicate slot" }
        : { intent_path: ctx.intentPath, decision: "accept", per_triple: [], aggregate_rationale: "ok" },
    );
    let report: TestVerifierLivelockReport | undefined;
    const paused = await runImplement(
      { request: "notifications send ordering", scopeHint: ["notifications/send"] },
      implementDeps("p4-livelock", { buildIndex: decoratedIndex, verifierFactory: livelockFactory, onLivelock: (r) => (report = r) }),
    );
    expect(paused.success).toBe(false);
    expect(report).toBeDefined();
    expect(report!.failing_triple_id).toBe("covers-persist-first");

    // 2 — resolve via the rewired modify_triple verb (scoped dialog, NOT inline payload).
    const runtime = authorRuntime([]);
    const writeDeps: WriteSurfaceDeps = {
      ...implementDeps("p4-livelock"),
      livelockReports: new Map([[report!.bead_id, report!]]),
      authorRuntime: runtime,
    };
    const opened = await duskResolveLivelock(writeDeps, { bead_id: report!.bead_id, verb: "modify_triple" });
    expect(opened.success).toBe(true);
    if (!opened.success || opened.value.verb !== "modify_triple") return;
    const dialogId = opened.value.dialog_id;

    // 3 — edit the failing triple and finalize: in-place writeback.
    await runtime.continue({
      dialog_id: dialogId,
      response: "assert observable ordering, not mock internals",
      payload: { edited_triple: { subject: "the unit test", predicate: "verifies", object: "the persisted row exists before the publish event", polarity: "positive" } },
    });
    const ready = await runtime.continue({ dialog_id: dialogId, response: "confirm" });
    if (!ready.success) throw new Error("confirm failed");
    expect(ready.value).toEqual({ finalize_ready: true });
    const finalized = await runtime.finalize({ dialog_id: dialogId });
    expect(finalized.success).toBe(true);

    // 4 — the bead resumes (re-invocation rebuilds the snapshot): every Verifier
    //     spawn in the new run reads the REFRESHED triple from its index.
    let tripleSeenByRun: string | undefined;
    const resumed = await runImplement(
      { request: "notifications send ordering", scopeHint: ["notifications/send"] },
      implementDeps("p4-livelock-resume", {
        // The re-invocation happens later in wall-clock time → a fresh bead id
        // (the paused bead's worktree is preserved per the livelock contract).
        clock: fixedClock(2_000),
        buildIndex: () => {
          const idx = decoratedIndex();
          tripleSeenByRun = idx.intents.get("notifications/send/unit-tests")?.triples?.find((t) => t.id === "covers-persist-first")?.object;
          return idx;
        },
      }),
    );
    expect(tripleSeenByRun).toBe("the persisted row exists before the publish event");
    expect(resumed.success).toBe(true);
    if (!resumed.success) return;
    expect(resumed.value.test_intents_executed).toContain("notifications/send/unit-tests");
  }, 60_000);
});
