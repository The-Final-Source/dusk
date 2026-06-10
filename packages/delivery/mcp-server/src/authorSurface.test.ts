import { stringify as stringifyYaml } from "yaml";
import type { DraftIntent, ScriptedAuthorResponse, TestVerifierLivelockReport } from "@dusk/core-schema";
import { readIntentFile } from "@dusk/core-parser";
import { createAuthorRuntime, type AuthorRuntime } from "@dusk/runtime-author";
import { DuskConfigSchema } from "@dusk/core-schema";
import { buildDerivedIndex } from "@dusk/core-index";
import { readRuntimeEnv } from "@dusk/runtime-orchestrator";
import { createTempRepo, makeScriptedAuthorGenerator, manualClock, type TempRepo } from "@dusk/test-harness";
import { describe, expect, test } from "vitest";

import { duskAuthorContinue, duskAuthorFinalize, duskAuthorStart, listDialogsQuery, type AuthorSurfaceDeps } from "./authorSurface.js";
import { duskResolveLivelock, type WriteSurfaceDeps } from "./writeSurface.js";

/**
 * §4 author-mcp-surface + §7.2/7.3 livelock rewire + §9.1 read surface —
 * zero-model via the scripted Author driver, real fs.
 */

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);

function authorDeps(repo: TempRepo, script: ScriptedAuthorResponse[]): AuthorSurfaceDeps & { runtime: AuthorRuntime } {
  const runtime = createAuthorRuntime({ rootDir: repo.dir, clock: manualClock(NOW), generator: makeScriptedAuthorGenerator(script) });
  return { runtime };
}

const TEST_INTENT_YAML = stringifyYaml({
  schema_version: 2,
  id: "api/widget/unit-tests",
  description: "Unit tests cover the widget shape.",
  obligation: "must",
  compose: "all",
  triples: [{ id: "covers-shape", subject: "the unit test", predicate: "verifies", object: "the widget shape" }],
});

const PROPOSAL_YAML = stringifyYaml({
  bead_id: "bd_20260610120000001",
  unsatisfiable_intents: ["api/widget"],
  diagnoses: [{ iter: 3, observation: "the shape triple is unsatisfiable as phrased" }],
  proposed_revisions: [{ intent: "api/widget", suggestion: "narrow the shape claim to the serialized form" }],
});

describe("4.1 — dusk_author_start entry modes", () => {
  test("fresh request opens at Stage 1 with a dialog on disk", async () => {
    const repo = createTempRepo({ git: false });
    const deps = authorDeps(repo, [{ expectStage: 1, question: "Confirm the framing?" }]);
    const r = await duskAuthorStart(deps, { request: "add cursor encoding for paginated lists" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.stage).toBe(1);
    expect(r.value.dialog_id).toMatch(/^dlg_[0-9]{17}$/);
    expect(r.value.next_question.length).toBeGreaterThan(0);
    expect(repo.exists(`.ia/runtime/dialogs/${r.value.dialog_id}/state.md`)).toBe(true);
    repo.cleanup();
  });

  test("scoped_triple_edit opens at Stage 4 with the failing triple pre-loaded", async () => {
    const repo = createTempRepo({ git: false });
    const deps = authorDeps(repo, []);
    const r = await duskAuthorStart(deps, {
      request: "edit the failing triple",
      entry_mode: "scoped_triple_edit",
      dialog_init: {
        failing_triple: { subject: "the unit test", predicate: "verifies", object: "the widget shape", polarity: "positive" },
        target_intent_path: "api/widget/unit-tests",
        failing_triple_id: "covers-shape",
      },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.stage).toBe(4);
    expect(r.value.next_question).toContain("covers-shape");
    repo.cleanup();
  });

  test("l2_recovery opens at Stage 3 with the proposal presented as the practice proposal", async () => {
    const repo = createTempRepo({ git: false, files: { ".ia/runtime/beads/bd_20260610120000001/intent-proposal.yaml": PROPOSAL_YAML } });
    const deps = authorDeps(repo, []);
    const r = await duskAuthorStart(deps, {
      request: "revise api/widget",
      entry_mode: "l2_recovery",
      dialog_init: { proposal_path: ".ia/runtime/beads/bd_20260610120000001/intent-proposal.yaml" },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.stage).toBe(3);
    expect(r.value.next_question).toContain("narrow the shape claim");
    expect(r.value.next_question.toLowerCase()).toContain("accept");
    repo.cleanup();
  });

  test("an unknown entry_mode is config_invalid", async () => {
    const repo = createTempRepo({ git: false });
    const r = await duskAuthorStart(authorDeps(repo, []), { request: "x", entry_mode: "phase5_mode" });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.kind).toBe("config_invalid");
    repo.cleanup();
  });
});

describe("4.2 — dusk_author_continue advances one turn", () => {
  test("framing confirmation advances 1 → 2; rejection loops back to 1; Stage 5 surfaces finalize_ready", async () => {
    const repo = createTempRepo({ git: false });
    const draft: DraftIntent = {
      id: "api/widget",
      description: "Widget endpoint returns typed widgets.",
      obligation: "must",
      triples: [{ id: "shape", subject: "the widget endpoint", predicate: "return", object: "a typed widget", polarity: "positive" }],
    };
    const deps = authorDeps(repo, [
      { expectStage: 1, question: "Framing v1?" },
      { expectStage: 1, question: "Framing v2?" },
      { expectStage: 2, question: "Tensions?", tensions: [] },
      { expectStage: 3, question: "Practice?", practiceProposal: "p" },
      { expectStage: 4, question: "Drafted. Layers?", draftPatch: draft },
    ]);
    const started = await duskAuthorStart(deps, { request: "widget endpoint" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;

    const looped = await duskAuthorContinue(deps, { dialog_id: id, response: "no, wrong framing" });
    expect(looped.success).toBe(true);
    if (!looped.success) return;
    expect(looped.value).toMatchObject({ stage: 1, next_question: "Framing v2?" });

    const advanced = await duskAuthorContinue(deps, { dialog_id: id, response: "yes that framing is correct" });
    expect(advanced.success).toBe(true);
    if (!advanced.success) return;
    expect(advanced.value).toMatchObject({ stage: 3 }); // zero tensions auto-advance to Stage 3

    await duskAuthorContinue(deps, { dialog_id: id, response: "accept" });
    await duskAuthorContinue(deps, { dialog_id: id, response: "no children", payload: { layers: [] } });
    const ready = await duskAuthorContinue(deps, { dialog_id: id, response: "confirm" });
    expect(ready.success).toBe(true);
    if (!ready.success) return;
    expect(ready.value).toEqual({ finalize_ready: true });
    // The dialog is preserved until finalize.
    expect(repo.exists(`.ia/runtime/dialogs/${id}/state.md`)).toBe(true);
    repo.cleanup();
  });
});

describe("4.3 — dusk_author_finalize", () => {
  test("finalize commits and destroys; finalize at an early stage is a typed error", async () => {
    const repo = createTempRepo({ git: false });
    const draft: DraftIntent = {
      id: "api/widget",
      description: "Widget endpoint returns typed widgets.",
      obligation: "must",
      triples: [{ id: "shape", subject: "the widget endpoint", predicate: "return", object: "a typed widget", polarity: "positive" }],
    };
    const deps = authorDeps(repo, [
      { expectStage: 1, question: "Framing?" },
      { expectStage: 2, question: "Tensions?", tensions: [] },
      { expectStage: 3, question: "Practice?", practiceProposal: "p" },
      { expectStage: 4, question: "Drafted. Layers?", draftPatch: draft },
    ]);
    const started = await duskAuthorStart(deps, { request: "widget endpoint" });
    if (!started.success) throw new Error("start failed");
    const id = started.value.dialog_id;

    const early = await duskAuthorFinalize(deps, { dialog_id: id });
    expect(early.success).toBe(false);
    if (!early.success) expect(early.error.kind).toBe("author_stage_invalid_response");

    await duskAuthorContinue(deps, { dialog_id: id, response: "yes" });
    await duskAuthorContinue(deps, { dialog_id: id, response: "accept" });
    await duskAuthorContinue(deps, { dialog_id: id, response: "none", payload: { layers: [] } });
    await duskAuthorContinue(deps, { dialog_id: id, response: "confirm" });

    const finalized = await duskAuthorFinalize(deps, { dialog_id: id });
    expect(finalized.success).toBe(true);
    if (!finalized.success) return;
    expect(finalized.value.intents_created).toEqual(["api/widget"]);
    expect(repo.exists(".ia/intents/api/widget/intent.yaml")).toBe(true);
    expect(repo.exists(`.ia/runtime/dialogs/${id}`)).toBe(false);
    repo.cleanup();
  });
});

describe("4.4 — typed DuskError envelope (P4-T9)", () => {
  test("unknown dialog id returns author_dialog_id_unknown with a start hint", async () => {
    const repo = createTempRepo({ git: false });
    const r = await duskAuthorContinue(authorDeps(repo, []), { dialog_id: "dlg_nonexistent", response: "hi" });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.kind).toBe("author_dialog_id_unknown");
    expect(r.error.recoverable).toBe(true);
    expect(r.error.recovery_hint).toContain("dusk_author_start");
    repo.cleanup();
  });

  test("a malformed structured response returns author_stage_invalid_response and preserves the stage", async () => {
    const repo = createTempRepo({ git: false });
    const deps = authorDeps(repo, [{ expectStage: 1, question: "Framing?" }]);
    const started = await duskAuthorStart(deps, { request: "widget" });
    if (!started.success) throw new Error("start failed");
    const r = await duskAuthorContinue(deps, { dialog_id: started.value.dialog_id, response: "pick", payload: { layers: "unit-tests" } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.kind).toBe("author_stage_invalid_response");
    expect(r.error.recoverable).toBe(true);
    repo.cleanup();
  });

  test("l2_recovery against a malformed proposal returns author_l2_proposal_unreadable without creating a dialog", async () => {
    const repo = createTempRepo({ git: false, files: { ".ia/runtime/beads/bd_x/intent-proposal.yaml": "not: [valid" } });
    const r = await duskAuthorStart(authorDeps(repo, []), {
      request: "revise",
      entry_mode: "l2_recovery",
      dialog_init: { proposal_path: ".ia/runtime/beads/bd_x/intent-proposal.yaml" },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.kind).toBe("author_l2_proposal_unreadable");
    expect(repo.exists(".ia/runtime/dialogs")).toBe(false);
    repo.cleanup();
  });
});

describe("7.2 / 7.3 — modify_triple opens a scoped dialog; finalize writes back in-place", () => {
  const report: TestVerifierLivelockReport = {
    bead_id: "bd_20260610120000001",
    test_intent_path: "api/widget/unit-tests",
    failing_triple_id: "covers-shape",
    failing_triple: { subject: "the unit test", predicate: "verifies", object: "the widget shape", polarity: "positive" },
    iterations_rejected: 3,
    engineer_attempts: [],
    verifier_persistent_rationale: { slot_focus_distribution: { predicate: 1 }, common_phrase: "x", full_rationales: [], confidence: 1 },
    suggested_resolutions: [],
  };

  function writeDeps(repo: TempRepo, runtime: AuthorRuntime): WriteSurfaceDeps {
    return {
      rootDir: repo.dir,
      sessionId: "s-livelock",
      env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }),
      taskRunner: async () => ({ output: "ok" }),
      verifierFactory: async () => ({ intent_path: "x", decision: "accept", per_triple: [], aggregate_rationale: "ok" }),
      buildIndex: () => buildDerivedIndex([], new Map()),
      clock: manualClock(NOW),
      config: DuskConfigSchema.parse({}),
      perEntryMax: 20,
      lifetimeMax: 40,
      livelockReports: new Map([[report.bead_id, report]]),
      authorRuntime: runtime,
    };
  }

  test("modify_triple opens a scoped dialog seeded from the report's failing triple", async () => {
    const repo = createTempRepo({ git: false, files: { ".ia/intents/api/widget/unit-tests/intent.yaml": TEST_INTENT_YAML } });
    const { runtime } = authorDeps(repo, []);
    const r = await duskResolveLivelock(writeDeps(repo, runtime), { bead_id: report.bead_id, verb: "modify_triple" });
    expect(r.success).toBe(true);
    if (!r.success || r.value.verb !== "modify_triple") return;
    expect(r.value.dialog_id).toMatch(/^dlg_/);
    expect(r.value.stage).toBe(4);
    expect(r.value.next_question).toContain("api/widget/unit-tests");
    repo.cleanup();
  });

  test("driving the scoped dialog to finalize replaces the failing triple in-place (no new intent file)", async () => {
    const repo = createTempRepo({ git: false, files: { ".ia/intents/api/widget/unit-tests/intent.yaml": TEST_INTENT_YAML } });
    const { runtime } = authorDeps(repo, []);
    const deps: AuthorSurfaceDeps = { runtime };
    const opened = await duskResolveLivelock(writeDeps(repo, runtime), { bead_id: report.bead_id, verb: "modify_triple" });
    if (!opened.success || opened.value.verb !== "modify_triple") throw new Error("open failed");
    const id = opened.value.dialog_id;

    const edited = await duskAuthorContinue(deps, {
      dialog_id: id,
      response: "tighten the assertion",
      payload: { edited_triple: { subject: "the unit test", predicate: "verifies", object: "the serialized widget shape on the wire", polarity: "positive" } },
    });
    expect(edited.success).toBe(true);
    const ready = await duskAuthorContinue(deps, { dialog_id: id, response: "confirm" });
    expect(ready.success).toBe(true);
    if (!ready.success) return;
    expect(ready.value).toEqual({ finalize_ready: true });

    const finalized = await duskAuthorFinalize(deps, { dialog_id: id });
    expect(finalized.success).toBe(true);
    if (!finalized.success) return;
    expect(finalized.value.intents_created).toEqual(["api/widget/unit-tests"]);

    const loaded = readIntentFile(`${repo.dir}/.ia/intents/api/widget/unit-tests/intent.yaml`, "api/widget/unit-tests");
    expect(loaded.success).toBe(true);
    if (!loaded.success) return;
    expect(loaded.intent.triples?.find((t) => t.id === "covers-shape")?.object).toBe("the serialized widget shape on the wire");
    // No NEW intent file was created anywhere else.
    expect(repo.exists(".ia/intents/api/widget/intent.yaml")).toBe(false);
    repo.cleanup();
  });
});

describe("9.1 — dusk_list_dialogs ↔ dusk://dialogs/active share one query", () => {
  test("outstanding dialogs appear; idle is empty", async () => {
    const repo = createTempRepo({ git: false });
    expect(listDialogsQuery(repo.dir)).toEqual({ success: true, value: { dialogs: [] } });

    const deps = authorDeps(repo, [{ expectStage: 1, question: "Framing?" }]);
    const started = await duskAuthorStart(deps, { request: "add cursor encoding" });
    if (!started.success) throw new Error("start failed");

    const listed = listDialogsQuery(repo.dir);
    expect(listed.success).toBe(true);
    if (!listed.success) return;
    expect(listed.value.dialogs).toHaveLength(1);
    expect(listed.value.dialogs[0]).toMatchObject({
      dialog_id: started.value.dialog_id,
      request: "add cursor encoding",
      current_stage: 1,
    });
    expect(listed.value.dialogs[0].created_at.length).toBeGreaterThan(0);
    expect(listed.value.dialogs[0].last_touched_at.length).toBeGreaterThan(0);
    repo.cleanup();
  });
});
