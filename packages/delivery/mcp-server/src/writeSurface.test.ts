import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";
import { DuskConfigSchema, type Intent, type TestVerifierLivelockReport, type VerifierFactory } from "@dusk/core-schema";
import { readRuntimeEnv } from "@dusk/runtime-orchestrator";
import { createMockGitWorktree, fixedClock, makeScriptedVerdictFactory, makeDuskTestCapture, type MockGitWorktree } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { duskCancel, duskImplement, duskResolveLivelock, duskTest, type WriteSurfaceDeps } from "./writeSurface.js";

// §13 — MCP write surface (zero-model via the scripted double).

const roleFile = (slug: string, memory: string): string =>
  ["---", "dusk_role_version: 2", `name: dusk-${slug}`, "description: t", "tools: [Read, Edit]", `memory: ${memory}`, "skills: []", "model: claude-sonnet-4-6", "---", "", `# ${slug}`, ""].join("\n");

const impl: Intent = { schema_version: 2, id: "api/widget", description: "w", obligation: "must", compose: "all", triples: [{ id: "shape", subject: "s", predicate: "p", object: "o", polarity: "positive" }], relates_to: [] };
const unit: Intent = { schema_version: 2, id: "api/widget/unit-tests", description: "u", obligation: "must", compose: "all", triples: [{ id: "covers-shape", subject: "s", predicate: "p", object: "o", polarity: "positive" }], relates_to: [] };

const rec = (file: string, marker: DecorationRecord["marker"], intentPath: string, aspects: string[]): DecorationRecord => ({ file, line: 1, scope: marker.includes("file") ? "file" : "declaration", declaration_name: marker.includes("file") ? null : "w", marker, intent_path: intentPath, aspect_ids: aspects, support_triple: null, ignore_clause: null });

const buildIndex = (): DerivedIndex =>
  buildDerivedIndex([rec("src/widget.ts", "intent", "api/widget", ["shape"]), rec("src/widget.unit.test.ts", "intent-test", "api/widget/unit-tests", ["covers-shape"])], new Map([["api/widget", impl], ["api/widget/unit-tests", unit]]));

const acceptFactory: VerifierFactory = makeScriptedVerdictFactory((ctx) => ({ intent_path: ctx.intentPath, decision: "accept", per_triple: [], aggregate_rationale: "ok" }));

let mg: MockGitWorktree;
let seq = 0;
beforeEach(() => {
  mg = createMockGitWorktree({ idBase: `2026061012000${seq++}` });
  mkdirSync(join(mg.repoDir, ".claude/agents"), { recursive: true });
  for (const [slug, memory] of [["engineer", "bead"], ["verifier", "none"], ["bead", "bead"], ["test-runner", "bead"]] as const) {
    writeFileSync(join(mg.repoDir, ".claude/agents", `dusk-${slug}.md`), roleFile(slug, memory));
  }
});
afterEach(() => mg.cleanup());

const deps = (sessionId: string): WriteSurfaceDeps => ({
  rootDir: mg.repoDir,
  sessionId,
  env: readRuntimeEnv({ DUSK_SPAWN_MODE: "test" }),
  taskRunner: async () => ({ output: "ok", model: "claude-sonnet-4-6", promptTokens: 1, completionTokens: 1, costUsd: 0, latencyMs: 1 }),
  verifierFactory: acceptFactory,
  buildIndex,
  clock: fixedClock(1_000),
  config: DuskConfigSchema.parse({}),
  perEntryMax: 20,
  lifetimeMax: 40,
  vitestRunner: (files) => makeDuskTestCapture(files.map((f) => ({ file: f, title: "t", status: "passed" as const, duration: 1 }))),
});

describe("13.1 — dusk_implement", () => {
  test("fresh request walks the pipeline and returns a summary", async () => {
    const r = await duskImplement(deps("w1"), { request: "add api/widget", scopeHint: ["api/widget"] });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.commits.length).toBeGreaterThanOrEqual(1);
  });
  test("neither request nor resume_token → config_invalid", async () => {
    const r = await duskImplement(deps("w2"), {});
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.kind).toBe("config_invalid");
  });
});

describe("13.2 — dusk_cancel returns a CancelResult", () => {
  test("cancel with no in-flight beads returns an empty-but-valid CancelResult", () => {
    const r = duskCancel(deps("w3"), { reason: "user abort" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.preserved.in_flight_tasks_drained).toBe(0);
  });
});

describe("13.3 — dusk_resolve_livelock dispatches the verb", () => {
  const report: TestVerifierLivelockReport = {
    bead_id: "bd_x",
    test_intent_path: "api/widget/unit-tests",
    failing_triple_id: "covers-shape",
    failing_triple: { subject: "s", predicate: "p", object: "o", polarity: "positive" },
    iterations_rejected: 3,
    engineer_attempts: [],
    verifier_persistent_rationale: { slot_focus_distribution: { predicate: 1 }, common_phrase: "x", full_rationales: [], confidence: 1 },
    suggested_resolutions: [],
  };
  test("accept_test_as_is returns a bypass instruction", async () => {
    const d = { ...deps("w4"), livelockReports: new Map([["bd_x", report]]) };
    const r = await duskResolveLivelock(d, { bead_id: "bd_x", verb: "accept_test_as_is" });
    expect(r.success).toBe(true);
    if (!r.success || r.value.verb !== "accept_test_as_is") return;
    expect(r.value.bypass.triple_id).toBe("covers-shape");
  });
  test("unknown bead → internal_error", async () => {
    const r = await duskResolveLivelock(deps("w5"), { bead_id: "bd_missing", verb: "escalate" });
    expect(r.success).toBe(false);
  });
  test("7.1 — the Phase-3 inline-payload form is rejected with config_invalid (hard cutover)", async () => {
    const d = { ...deps("w7"), livelockReports: new Map([["bd_x", report]]) };
    const r = await duskResolveLivelock(d, {
      bead_id: "bd_x",
      verb: "modify_triple",
      payload: { edited_triple: { id: "covers-shape", subject: "s2", predicate: "p2", object: "o2", polarity: "positive" } },
    } as never);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.kind).toBe("config_invalid");
    expect(r.error.message).toContain("payload");
    expect(r.error.recovery_hint).toContain("dialog");
  });
});

describe("13.4 — /dusk-test standalone returns a TestVerdict", () => {
  test("runs the Test Runner over a scope without persistent bead memory", async () => {
    const r = await duskTest(deps("w6"), "api/widget/unit-tests");
    expect(r.success).toBe(true);
    if (!r.success || r.value.kind !== "verdict") return;
    expect(r.value.verdict.test_intent_path).toBe("api/widget/unit-tests");
    expect(r.value.verdict.decision).toBe("pass");
  });
});
