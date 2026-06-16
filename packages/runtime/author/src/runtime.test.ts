import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { describe, expect, test } from "vitest";
import type { DraftIntent, ScriptedAuthorResponse } from "@dusk/core-schema";
import { readIntentFile } from "@dusk/core-parser";
import { buildDialogState, createTempRepo, makeScriptedAuthorGenerator, manualClock, readDialogTail, type TempRepo } from "@dusk/test-harness";

import { createAuthorRuntime, type AuthorRuntimeDeps } from "./runtime.js";
import { writeDialogState } from "./dialogStore.js";

/**
 * §2.3/2.5 dialog lifecycle + §3 five-stage flow, all zero-model via the
 * scripted Author driver against the real file system.
 */

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);

function makeRuntime(repo: TempRepo, script: ScriptedAuthorResponse[], extra: Partial<AuthorRuntimeDeps> = {}) {
  return createAuthorRuntime({
    rootDir: repo.dir,
    clock: manualClock(NOW),
    generator: makeScriptedAuthorGenerator(script),
    ...extra,
  });
}

const IMPL_DRAFT: DraftIntent = {
  id: "api/pagination/cursor-only/cursor-encode",
  description: "Cursor encoding produces an opaque token from a typed state.",
  obligation: "must",
  triples: [
    { id: "opaque-token", subject: "the cursor encode function", predicate: "produce", object: "an opaque base64url cursor token", polarity: "positive" },
    { id: "roundtrip", subject: "the cursor encode function", predicate: "produce", object: "a token the decode function accepts", polarity: "positive" },
  ],
};

const FULL_SCRIPT: ScriptedAuthorResponse[] = [
  { expectStage: 1, question: "Framing: you want opaque cursor encoding for list pagination. Confirm or correct?" },
  {
    expectStage: 2,
    question: "Discovery found one tension. How should it resolve?",
    tensions: [{ target: "api/pagination/cursor-only", classification: "overlap", excerpt: "cursor pagination parent", resolution_options: ["extend the parent", "supersede it"] }],
  },
  { expectStage: 3, question: "Accept this practice proposal?", practiceProposal: "Industry practice: split encode/decode; encode produces opaque base64url tokens." },
  { expectStage: 4, question: "Drafted the impl intent. Pick test-pyramid layers (payload.layers).", draftPatch: IMPL_DRAFT },
];

async function driveToFinalizeReady(repo: TempRepo, script: ScriptedAuthorResponse[] = FULL_SCRIPT) {
  const runtime = makeRuntime(repo, script);
  const started = await runtime.start({ request: "add cursor encoding for paginated lists" });
  expect(started.success).toBe(true);
  if (!started.success) throw new Error("start failed");
  const id = started.value.dialog_id;

  const confirmFraming = await runtime.continue({ dialog_id: id, response: "yes that framing is correct" });
  expect(confirmFraming.success).toBe(true);
  const resolveTension = await runtime.continue({
    dialog_id: id,
    response: "extend the parent",
    payload: { resolutions: [{ target: "api/pagination/cursor-only", resolution: "extend the parent" }] },
  });
  expect(resolveTension.success).toBe(true);
  const acceptPractice = await runtime.continue({ dialog_id: id, response: "accept" });
  expect(acceptPractice.success).toBe(true);
  const pickLayers = await runtime.continue({ dialog_id: id, response: "unit + integration", payload: { layers: ["unit-tests", "integration-tests"] } });
  expect(pickLayers.success).toBe(true);
  const confirmDraft = await runtime.continue({ dialog_id: id, response: "confirm" });
  expect(confirmDraft.success).toBe(true);
  if (!confirmDraft.success) throw new Error("confirm failed");
  expect(confirmDraft.value).toEqual({ finalize_ready: true });
  return { runtime, id };
}

describe("3.x — scripted full flow advances through every stage (P4-T1)", () => {
  test("start → 5 continues → finalize_ready → finalize creates impl + picked children", async () => {
    const repo = createTempRepo({ git: false });
    const { runtime, id } = await driveToFinalizeReady(repo);

    const finalized = await runtime.finalize({ dialog_id: id });
    expect(finalized.success).toBe(true);
    if (!finalized.success) return;
    expect(finalized.value.intents_created.sort()).toEqual([
      "api/pagination/cursor-only/cursor-encode",
      "api/pagination/cursor-only/cursor-encode/integration-tests",
      "api/pagination/cursor-only/cursor-encode/unit-tests",
    ]);
    // Every file is schema-valid v2 on disk; the dialog directory is gone.
    for (const path of finalized.value.intents_created) {
      const loaded = readIntentFile(`${repo.dir}/.ia/intents/${path}/intent.yaml`, path);
      expect(loaded.success).toBe(true);
    }
    expect(repo.exists(`.ia/runtime/dialogs/${id}`)).toBe(false);
    repo.cleanup();
  });

  test("pure-leaf pick {unit} drafts exactly impl + one child (P4-T3)", async () => {
    const repo = createTempRepo({ git: false });
    const runtime = makeRuntime(repo, FULL_SCRIPT);
    const started = await runtime.start({ request: "add cursor encoding for paginated lists" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;
    await runtime.continue({ dialog_id: id, response: "yes" });
    await runtime.continue({ dialog_id: id, response: "extend", payload: { resolutions: [{ target: "api/pagination/cursor-only", resolution: "extend" }] } });
    await runtime.continue({ dialog_id: id, response: "accept" });
    await runtime.continue({ dialog_id: id, response: "unit only", payload: { layers: ["unit-tests"] } });

    const tail = readDialogTail(repo.dir, id);
    expect(tail).not.toBeNull();
    const persisted = await runtime.continue({ dialog_id: id, response: "confirm" });
    expect(persisted.success).toBe(true);
    if (!persisted.success) return;
    expect(persisted.value).toEqual({ finalize_ready: true });

    const finalized = await runtime.finalize({ dialog_id: id });
    if (!finalized.success) throw new Error("finalize failed");
    expect(finalized.value.intents_created.sort()).toEqual(["api/pagination/cursor-only/cursor-encode", "api/pagination/cursor-only/cursor-encode/unit-tests"]);
    repo.cleanup();
  });
});

describe("3.x — Stage 3 surfaces the practice proposal in next_question (regression)", () => {
  test("normal path (post-tension-resolution): next_question carries the proposal, not just the bare question", async () => {
    const repo = createTempRepo({ git: false });
    const runtime = makeRuntime(repo, FULL_SCRIPT);
    const started = await runtime.start({ request: "add cursor encoding for paginated lists" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;
    await runtime.continue({ dialog_id: id, response: "yes that framing is correct" });
    const atStage3 = await runtime.continue({
      dialog_id: id,
      response: "extend the parent",
      payload: { resolutions: [{ target: "api/pagination/cursor-only", resolution: "extend the parent" }] },
    });
    expect(atStage3.success).toBe(true);
    if (!atStage3.success || !("next_question" in atStage3.value)) throw new Error("expected a stage-3 question");
    expect(atStage3.value.stage).toBe(3);
    expect(atStage3.value.next_question).toContain("Industry practice: split encode/decode");
    expect(atStage3.value.next_question).toContain("Accept this practice proposal?");
    repo.cleanup();
  });

  test("zero-tension fast path: next_question carries the proposal too", async () => {
    const repo = createTempRepo({ git: false });
    const script: ScriptedAuthorResponse[] = [
      { expectStage: 1, question: "Framing?" },
      { expectStage: 2, question: "Tensions?", tensions: [] },
      { expectStage: 3, question: "Accept this practice proposal?", practiceProposal: "Industry practice: opaque base64url tokens." },
      { expectStage: 4, question: "Pick layers.", draftPatch: IMPL_DRAFT },
    ];
    const runtime = makeRuntime(repo, script);
    const started = await runtime.start({ request: "a rule" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;
    // tensions:[] auto-advances Stage 2 → Stage 3 in a single continue.
    const atStage3 = await runtime.continue({ dialog_id: id, response: "yes" });
    expect(atStage3.success).toBe(true);
    if (!atStage3.success || !("next_question" in atStage3.value)) throw new Error("expected a stage-3 question");
    expect(atStage3.value.stage).toBe(3);
    expect(atStage3.value.next_question).toContain("Industry practice: opaque base64url tokens.");
    expect(atStage3.value.next_question).toContain("Accept this practice proposal?");
    repo.cleanup();
  });
});

describe("3.2 — Stage-1 framing loopback (P4-T11)", () => {
  test("a rejected framing regenerates without advancing; a confirmation then advances", async () => {
    const repo = createTempRepo({ git: false });
    const script: ScriptedAuthorResponse[] = [
      { expectStage: 1, question: "Framing v1: cursor decoding?" },
      { expectStage: 1, question: "Framing v2: cursor ENCODING for paginated lists?" },
      { expectStage: 2, question: "Discovery…", tensions: [{ target: "x", classification: "adjacent", resolution_options: [] }] },
    ];
    const runtime = makeRuntime(repo, script);
    const started = await runtime.start({ request: "add cursor encoding" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;

    const rejected = await runtime.continue({ dialog_id: id, response: "no — encoding, not decoding" });
    expect(rejected.success).toBe(true);
    if (!rejected.success) return;
    expect(rejected.value).toMatchObject({ stage: 1, next_question: "Framing v2: cursor ENCODING for paginated lists?" });
    expect(readDialogTail(repo.dir, id)?.frontmatter.current_stage).toBe(1);

    const confirmed = await runtime.continue({ dialog_id: id, response: "yes that framing is correct" });
    expect(confirmed.success).toBe(true);
    if (!confirmed.success) return;
    expect(confirmed.value).toMatchObject({ stage: 2 });
    repo.cleanup();
  });
});

describe("3.6 — Stage 4.5 bounces with typed skill hints", () => {
  const bounceCase = async (draft: DraftIntent, expectedHint: string) => {
    const repo = createTempRepo({ git: false });
    const script: ScriptedAuthorResponse[] = [
      { expectStage: 1, question: "Framing?" },
      { expectStage: 2, question: "Tensions?", tensions: [] },
      // tensions: [] auto-advances to Stage 3:
      { expectStage: 3, question: "Practice?", practiceProposal: "p" },
      { expectStage: 4, question: "Draft ready; pick layers.", draftPatch: draft },
    ];
    const runtime = makeRuntime(repo, script);
    const started = await runtime.start({ request: "a rule" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;
    await runtime.continue({ dialog_id: id, response: "yes" });
    await runtime.continue({ dialog_id: id, response: "accept" });
    await runtime.continue({ dialog_id: id, response: "none", payload: { layers: [] } });
    const bounced = await runtime.continue({ dialog_id: id, response: "confirm" });
    expect(bounced.success).toBe(true);
    if (!bounced.success) throw new Error("bounce failed");
    expect(bounced.value).toMatchObject({ stage: 4 });
    if ("next_question" in bounced.value) {
      expect(bounced.value.next_question).toContain(expectedHint);
    }
    expect(readDialogTail(repo.dir, id)?.frontmatter.current_stage).toBe(4);
    repo.cleanup();
  };

  test("matrix-predicate negation bounces with polarity-decision", async () => {
    await bounceCase(
      {
        id: "api/no-offset",
        description: "List endpoints avoid offset pagination.",
        obligation: "must",
        triples: [{ id: "t1", subject: "list endpoints", predicate: "does not use", object: "offset pagination", polarity: "positive" }],
      },
      "polarity-decision",
    );
  });

  test("behavioral antecedent bounces with implies-antecedent-grammar", async () => {
    await bounceCase(
      {
        id: "api/idempotency-on-writes",
        description: "Write endpoints validate idempotency.",
        obligation: "must",
        compose: "implies",
        antecedent: [{ id: "a1", subject: "the endpoint", predicate: "performs a write", object: "api/write-endpoint" }],
        consequent: [{ id: "c1", subject: "the endpoint", predicate: "validate", object: "an idempotency key", polarity: "positive" }],
      },
      "implies-antecedent-grammar",
    );
  });

  test("refines relates_to kind bounces with typed-relates-to", async () => {
    await bounceCase(
      {
        id: "api/widget",
        description: "Widget endpoint returns typed widgets.",
        obligation: "must",
        triples: [{ id: "t1", subject: "the widget endpoint", predicate: "return", object: "a typed widget", polarity: "positive" }],
        relates_to: [{ kind: "refines", target: "api/other" }],
      },
      "typed-relates-to",
    );
  });

  test("after a bounce, a corrected draft passes 4.5 and reaches Stage 5 (smoke Variant C shape)", async () => {
    const repo = createTempRepo({ git: false });
    const bad: DraftIntent = {
      id: "api/no-offset",
      description: "List endpoints avoid offset pagination.",
      obligation: "must",
      triples: [{ id: "t1", subject: "list endpoints", predicate: "does not use", object: "offset pagination", polarity: "positive" }],
    };
    const good: DraftIntent = { ...bad, triples: [{ id: "t1", subject: "list endpoints", predicate: "use", object: "offset pagination", polarity: "negative" }] };
    const script: ScriptedAuthorResponse[] = [
      { expectStage: 1, question: "Framing?" },
      { expectStage: 2, question: "Tensions?", tensions: [] },
      { expectStage: 3, question: "Practice?", practiceProposal: "p" },
      { expectStage: 4, question: "Drafted. Layers?", draftPatch: bad },
      { expectStage: 4, question: "Corrected the polarity.", draftPatch: good },
    ];
    const runtime = makeRuntime(repo, script);
    const started = await runtime.start({ request: "list endpoints must not use offset pagination" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;
    await runtime.continue({ dialog_id: id, response: "yes" });
    await runtime.continue({ dialog_id: id, response: "accept" });
    await runtime.continue({ dialog_id: id, response: "none", payload: { layers: [] } });
    const bounced = await runtime.continue({ dialog_id: id, response: "confirm" });
    if (!bounced.success) throw new Error("bounce failed");
    expect(bounced.value).toMatchObject({ stage: 4 });

    // Revise (routes through the generator), then confirm again.
    const revised = await runtime.continue({ dialog_id: id, response: "use polarity negative instead", payload: { kind: "revise_draft" } });
    expect(revised.success).toBe(true);
    const done = await runtime.continue({ dialog_id: id, response: "confirm" });
    if (!done.success) throw new Error("confirm failed");
    expect(done.value).toEqual({ finalize_ready: true });

    const finalized = await runtime.finalize({ dialog_id: id });
    expect(finalized.success).toBe(true);
    if (!finalized.success) return;
    const loaded = readIntentFile(`${repo.dir}/.ia/intents/api/no-offset/intent.yaml`, "api/no-offset");
    expect(loaded.success).toBe(true);
    if (!loaded.success) return;
    expect(loaded.intent.triples?.[0].polarity).toBe("negative");
    repo.cleanup();
  });
});

describe("3.9 — typed relates_to emission + reciprocal proposal (P4-T6)", () => {
  test("an implies edge surfaces a reciprocal proposal; confirmation adds the reciprocal draft; no refines anywhere", async () => {
    const repo = createTempRepo({ git: false });
    const withImplies: DraftIntent = {
      ...IMPL_DRAFT,
      relates_to: [{ kind: "implies", target: "api/idempotency-on-writes" }],
    };
    const reciprocal: DraftIntent = {
      id: "api/idempotency-on-writes",
      description: "Write endpoints validate idempotency.",
      obligation: "must",
      triples: [{ id: "c1", subject: "the endpoint", predicate: "validate", object: "an idempotency key", polarity: "positive" }],
      relates_to: [{ kind: "sibling", target: IMPL_DRAFT.id! }],
    };
    const script: ScriptedAuthorResponse[] = [
      { expectStage: 1, question: "Framing?" },
      { expectStage: 2, question: "Tensions?", tensions: [] },
      { expectStage: 3, question: "Practice?", practiceProposal: "p" },
      { expectStage: 4, question: "Drafted with an implies edge. Layers?", draftPatch: withImplies },
      { expectStage: 4, question: "Added the reciprocal sibling edge on the target.", draftPatch: reciprocal },
    ];
    const runtime = makeRuntime(repo, script);
    const started = await runtime.start({ request: "cursor encoding implies idempotency" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;
    await runtime.continue({ dialog_id: id, response: "yes" });
    await runtime.continue({ dialog_id: id, response: "accept" });

    const afterLayers = await runtime.continue({ dialog_id: id, response: "none", payload: { layers: [] } });
    expect(afterLayers.success).toBe(true);
    if (!afterLayers.success) return;
    // The reciprocal proposal is the next question.
    expect(afterLayers.value).toMatchObject({ stage: 4 });
    if ("next_question" in afterLayers.value) {
      expect(afterLayers.value.next_question).toContain("reciprocal");
      expect(afterLayers.value.next_question).toContain("api/idempotency-on-writes");
    }

    const confirmed = await runtime.continue({ dialog_id: id, response: "yes, add it" });
    expect(confirmed.success).toBe(true);
    const done = await runtime.continue({ dialog_id: id, response: "confirm" });
    if (!done.success) throw new Error("confirm failed");
    expect(done.value).toEqual({ finalize_ready: true });

    const tail = readDialogTail(repo.dir, id);
    expect(tail?.raw).toContain("kind: implies");
    expect(tail?.raw).toContain("kind: sibling");
    expect(tail?.raw).not.toContain("refines");
    repo.cleanup();
  });
});

describe("3.10 — Stage-5 finalize atomicity (P4-T7)", () => {
  test("a write failure on the second file rolls back ALL writes and preserves the dialog", async () => {
    const repo = createTempRepo({ git: false });
    let writes = 0;
    const failingFs = {
      mkdir: (dir: string) => mkdirSync(dir, { recursive: true }),
      writeFile: (path: string, content: string) => {
        writes += 1;
        if (writes === 2) throw new Error("disk full (injected)");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, "utf8");
      },
      rename: (from: string, to: string) => renameSync(from, to),
    };
    const runtime = makeRuntime(repo, FULL_SCRIPT, { finalizeFs: failingFs });
    const started = await runtime.start({ request: "add cursor encoding for paginated lists" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;
    await runtime.continue({ dialog_id: id, response: "yes" });
    await runtime.continue({ dialog_id: id, response: "extend", payload: { resolutions: [{ target: "api/pagination/cursor-only", resolution: "extend" }] } });
    await runtime.continue({ dialog_id: id, response: "accept" });
    await runtime.continue({ dialog_id: id, response: "both", payload: { layers: ["unit-tests", "integration-tests"] } });
    const ready = await runtime.continue({ dialog_id: id, response: "confirm" });
    if (!ready.success) throw new Error("ready failed");

    const failed = await runtime.finalize({ dialog_id: id });
    expect(failed.success).toBe(false);
    if (failed.success) return;
    expect(failed.error.kind).toBe("author_finalize_partial_failure");
    expect(failed.error.recoverable).toBe(true);
    expect(failed.error.details?.failed_intent_path).toBeDefined();
    // No intent file landed at ANY of the three paths.
    for (const path of [
      "api/pagination/cursor-only/cursor-encode",
      "api/pagination/cursor-only/cursor-encode/unit-tests",
      "api/pagination/cursor-only/cursor-encode/integration-tests",
    ]) {
      expect(repo.exists(`.ia/intents/${path}/intent.yaml`)).toBe(false);
    }
    // The dialog is preserved for a re-finalize.
    expect(repo.exists(`.ia/runtime/dialogs/${id}/state.md`)).toBe(true);
    repo.cleanup();
  });

  test("finalize before Stage 5 returns author_stage_invalid_response", async () => {
    const repo = createTempRepo({ git: false });
    const runtime = makeRuntime(repo, FULL_SCRIPT);
    const started = await runtime.start({ request: "add cursor encoding for paginated lists" });
    if (!started.success) throw new Error("start failed");
    const early = await runtime.finalize({ dialog_id: started.value.dialog_id });
    expect(early.success).toBe(false);
    if (early.success) return;
    expect(early.error.kind).toBe("author_stage_invalid_response");
    expect(early.error.message).toContain("stage 1");
    repo.cleanup();
  });
});

describe("2.3 / 2.5 — persistence on every transition + cross-restart survival (P4-T13)", () => {
  test("state persists at every turn; a fresh runtime instance resumes from disk", async () => {
    const repo = createTempRepo({ git: false });
    const script: ScriptedAuthorResponse[] = [
      { expectStage: 1, question: "Framing?" },
      { expectStage: 2, question: "Tensions?", tensions: [{ target: "x", classification: "gray", resolution_options: [] }] },
      { expectStage: 3, question: "Practice?", practiceProposal: "p" },
    ];
    const runtime = makeRuntime(repo, script);
    const started = await runtime.start({ request: "add cursor encoding" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;
    expect(readDialogTail(repo.dir, id)?.frontmatter.current_stage).toBe(1);

    await runtime.continue({ dialog_id: id, response: "yes" });
    expect(readDialogTail(repo.dir, id)?.frontmatter.current_stage).toBe(2);
    await runtime.continue({ dialog_id: id, response: "fold it in", payload: { resolutions: [{ target: "x", resolution: "fold it in" }] } });
    expect(readDialogTail(repo.dir, id)?.frontmatter.current_stage).toBe(3);

    // "Restart": a brand-new runtime instance with a fresh script for the NEXT stage only.
    const restarted = makeRuntime(repo, [{ expectStage: 4, question: "Drafted post-restart.", draftPatch: IMPL_DRAFT }]);
    const resumed = await restarted.continue({ dialog_id: id, response: "accept" });
    expect(resumed.success).toBe(true);
    if (!resumed.success) return;
    expect(resumed.value).toMatchObject({ stage: 4, next_question: "Drafted post-restart." });

    const tail = readDialogTail(repo.dir, id);
    expect(tail?.frontmatter.current_stage).toBe(4);
    expect(tail?.turns.length).toBeGreaterThanOrEqual(7); // 4 author + 3 user turns accumulated
    repo.cleanup();
  });

  test("continue against an unknown dialog returns author_dialog_id_unknown with a start hint", async () => {
    const repo = createTempRepo({ git: false });
    const runtime = makeRuntime(repo, []);
    const result = await runtime.continue({ dialog_id: "dlg_nonexistent", response: "hello" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.kind).toBe("author_dialog_id_unknown");
    expect(result.error.recovery_hint).toContain("dusk_author_start");
    repo.cleanup();
  });
});

describe("entry modes (4.1 surface behavior at the runtime layer)", () => {
  test("scoped_triple_edit opens at Stage 4 with the failing triple pre-loaded", async () => {
    const repo = createTempRepo({ git: false });
    const runtime = makeRuntime(repo, []);
    const started = await runtime.start({
      request: "edit the failing triple",
      entry_mode: "scoped_triple_edit",
      dialog_init: {
        failing_triple: { subject: "the unit test", predicate: "verifies", object: "the wrong thing", polarity: "positive" },
        target_intent_path: "api/widget/unit-tests",
        failing_triple_id: "covers-shape",
      },
    });
    expect(started.success).toBe(true);
    if (!started.success) return;
    expect(started.value.stage).toBe(4);
    expect(started.value.next_question).toContain("api/widget/unit-tests");
    const tail = readDialogTail(repo.dir, started.value.dialog_id);
    expect(tail?.raw).toContain("covers-shape");
    expect(tail?.raw).toContain("the wrong thing");
    repo.cleanup();
  });

  test("l2_recovery with a missing proposal returns author_l2_proposal_unreadable and creates NO dialog", async () => {
    const repo = createTempRepo({ git: false });
    const runtime = makeRuntime(repo, []);
    const started = await runtime.start({ request: "revise", entry_mode: "l2_recovery", dialog_init: { proposal_path: ".ia/runtime/beads/bd_x/intent-proposal.yaml" } });
    expect(started.success).toBe(false);
    if (started.success) return;
    expect(started.error.kind).toBe("author_l2_proposal_unreadable");
    expect(repo.exists(".ia/runtime/dialogs")).toBe(false);
    repo.cleanup();
  });
});

describe("3.x — Stage-4 set-mutation: a revision that REMOVES drafts is honored at finalize (arch-board A4)", () => {
  test("removedDraftIds drops a drafted child + cascades to its pyramid children; finalize does NOT write them", async () => {
    const repo = createTempRepo({ git: false });
    // Draft the impl + a second conditional intent WITH its own pyramid child, then
    // a Stage-4 revision drops the conditional intent by id.
    const conditional: DraftIntent = {
      id: "api/pagination/cursor-only/cursor-decode",
      description: "Cursor decoding parses an opaque token back to typed state.",
      obligation: "must",
      triples: [{ id: "parse", subject: "the cursor decode function", predicate: "parse", object: "an opaque token to typed state", polarity: "positive" }],
    };
    const conditionalChild: DraftIntent = {
      id: "api/pagination/cursor-only/cursor-decode/unit-tests",
      description: "Unit tests cover cursor decode.",
      obligation: "must",
      triples: [{ id: "covers", subject: "the unit test", predicate: "cover", object: "decode round-trip", polarity: "positive" }],
    };
    const script: ScriptedAuthorResponse[] = [
      ...FULL_SCRIPT,
      // Stage-4 revision: emit the conditional + its child first…
      { expectStage: 4, question: "Added a decode intent + its unit child.", drafts: [conditional, conditionalChild] },
      // …then a later revision DROPS the decode intent by id (cascades to the child).
      { expectStage: 4, question: "Dropped the decode intent.", removedDraftIds: [conditional.id!] },
    ];
    const { runtime, id } = await driveToFinalizeReady(repo, script);

    // First revision adds decode + child.
    const added = await runtime.continue({ dialog_id: id, response: "add a decode intent", payload: { kind: "revise_draft" } });
    expect(added.success).toBe(true);
    // Second revision removes decode (and its child by cascade).
    const removed = await runtime.continue({ dialog_id: id, response: "drop the decode intent", payload: { kind: "revise_draft" } });
    expect(removed.success).toBe(true);
    const confirmed = await runtime.continue({ dialog_id: id, response: "confirm" });
    expect(confirmed.success).toBe(true);

    const finalized = await runtime.finalize({ dialog_id: id });
    expect(finalized.success).toBe(true);
    if (!finalized.success) return;
    // The dropped intent + its cascaded child are absent; impl + its picked children remain.
    expect(finalized.value.intents_created).not.toContain(conditional.id);
    expect(finalized.value.intents_created).not.toContain(conditionalChild.id);
    expect(finalized.value.intents_created).toContain("api/pagination/cursor-only/cursor-encode");
    expect(repo.exists(`.ia/intents/${conditional.id}/intent.yaml`)).toBe(false);
    repo.cleanup();
  });

  test("a pyramid RE-PICK to fewer layers removes de-selected children and never duplicates a retained one", async () => {
    const repo = createTempRepo({ git: false });
    const runtime = makeRuntime(repo, FULL_SCRIPT);
    const started = await runtime.start({ request: "add cursor encoding for paginated lists" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;
    await runtime.continue({ dialog_id: id, response: "yes that framing is correct" });
    await runtime.continue({
      dialog_id: id,
      response: "extend the parent",
      payload: { resolutions: [{ target: "api/pagination/cursor-only", resolution: "extend the parent" }] },
    });
    await runtime.continue({ dialog_id: id, response: "accept" });
    // Pick two layers, then RE-PICK keeping only unit-tests.
    await runtime.continue({ dialog_id: id, response: "unit + integration", payload: { layers: ["unit-tests", "integration-tests"] } });
    await runtime.continue({ dialog_id: id, response: "actually just unit", payload: { layers: ["unit-tests"] } });
    const confirmed = await runtime.continue({ dialog_id: id, response: "confirm" });
    expect(confirmed.success).toBe(true);

    const finalized = await runtime.finalize({ dialog_id: id });
    expect(finalized.success).toBe(true);
    if (!finalized.success) return;
    const children = finalized.value.intents_created.filter((p) => p.startsWith("api/pagination/cursor-only/cursor-encode/"));
    // Exactly one child, unit-tests; integration-tests de-selected; no duplicate.
    expect(children).toEqual(["api/pagination/cursor-only/cursor-encode/unit-tests"]);
    repo.cleanup();
  });
});
