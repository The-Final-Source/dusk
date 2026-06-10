import { buildDerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";
import type { Intent } from "@dusk/core-schema";
import {
  buildSessionSnapshot,
  createBeadDelta,
  endActiveRun,
  startActiveRun,
  upsertBead,
} from "@dusk/runtime-orchestrator";
import { newResumeToken, suggestedDialogSeed, writeCheckpoint } from "@dusk/runtime-implement-checkpoint";
import { createTempRepo, fixedClock, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildContext } from "./context.js";
import { inspectQuery, listBeadsQuery, listCheckpointsQuery } from "./queries.js";

// §14 MODIFIED — mcp-read-surface populated during an in-flight pipeline.

const clock = fixedClock(Date.parse("2026-06-10T00:00:00.000Z"));
const intent: Intent = { schema_version: 2, id: "api/x", description: "x", obligation: "must", compose: "all", triples: [{ id: "t1", subject: "s", predicate: "p", object: "o", polarity: "positive" }], relates_to: [] };
const rec = (file: string): DecorationRecord => ({ file, line: 1, scope: "declaration", declaration_name: "x", marker: "intent", intent_path: "api/x", aspect_ids: ["t1"], support_triple: null, ignore_clause: null });

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
  endActiveRun();
});
afterEach(() => {
  repo.cleanup();
  endActiveRun();
});

const ctx = () =>
  buildContext({ rootDir: repo.dir, index: buildDerivedIndex([rec("src/base.ts")], new Map([["api/x", intent]])), intents: new Map([["api/x", intent]]), readFile: () => "" });

describe("14.1 — dusk_list_beads", () => {
  test("populated during an in-flight pipeline; empty when idle", () => {
    const idle = listBeadsQuery(ctx());
    expect(idle.success && idle.value.beads).toEqual([]);

    const snapshot = buildSessionSnapshot({ repoDir: repo.dir, buildIndex: () => buildDerivedIndex([], new Map()), resolveCommit: () => "c0" });
    const run = startActiveRun("s1", snapshot);
    upsertBead(run, { id: "bd_1", status: "short_cycle", current_step: "Step 4 — short cycle", started_at: "2026-06-10T00:00:00.000Z", branch: "dusk/bd_1" });

    const result = listBeadsQuery(ctx());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.beads).toHaveLength(1);
    expect(result.value.beads[0]).toMatchObject({ id: "bd_1", status: "short_cycle", branch: "dusk/bd_1" });
  });
});

describe("14.2 — dusk_list_implement_checkpoints", () => {
  test("enumerates outstanding checkpoints; empty when none", () => {
    const idle = listCheckpointsQuery(ctx());
    expect(idle.success && idle.value.checkpoints).toEqual([]);

    const token = newResumeToken(clock, 1);
    writeCheckpoint(repo.dir, token, {
      schema_version: 1,
      original_request: "add a thing",
      decomposer_partial_state: { active_intents: [], edges: [] },
      intents_resolved_so_far: [],
      intents_still_unresolved: ["api/missing"],
      suggested_dialog_seed: suggestedDialogSeed(["api/missing"]),
      unresolved_refs: ["api/missing"],
      created_at: "2026-06-10T00:00:00.000Z",
      last_touched_at: "2026-06-10T00:00:00.000Z",
    });

    const result = listCheckpointsQuery(ctx());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.checkpoints).toHaveLength(1);
    expect(result.value.checkpoints[0]).toMatchObject({ resume_token: token, original_request: "add a thing", unresolved_refs: ["api/missing"] });
  });
});

describe("14.3 — dusk_inspect reads against the snapshot, not bead deltas", () => {
  test("an in-flight bead delta decoration is NOT visible to inspect", () => {
    const snapshot = buildSessionSnapshot({ repoDir: repo.dir, buildIndex: () => buildDerivedIndex([rec("src/base.ts")], new Map([["api/x", intent]])), resolveCommit: () => "c0" });
    const run = startActiveRun("s1", snapshot);
    const delta = createBeadDelta("bd_1");
    delta.add({ ...rec("src/in-flight.ts") });
    run.deltas.set("bd_1", delta);

    const result = inspectQuery(ctx(), "api/x");
    expect(result.success).toBe(true);
    if (!result.success) return;
    // The read surface sees only the snapshot's claim (base.ts), never the delta.
    expect(result.value.claims.map((c) => c.file)).toEqual(["src/base.ts"]);
    expect(result.value.claims.map((c) => c.file)).not.toContain("src/in-flight.ts");
  });
});
