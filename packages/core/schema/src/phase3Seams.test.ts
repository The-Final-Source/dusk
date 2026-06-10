import { describe, expect, test } from "vitest";

import {
  CancelResultSchema,
  CommitTrailersSchema,
  DUSK_ERROR_KINDS,
  DecomposerPartialStateSchema,
  ImplementCheckpointSchema,
  TestVerdictSchema,
  TestVerifierLivelockReportSchema,
} from "./index.js";

// Task 1.2 — every Phase-3 frozen seam parses against its Zod schema (unit-only).

describe("ImplementCheckpoint (RFC §10.1.1; design D4)", () => {
  const canonical = {
    schema_version: 1 as const,
    original_request: "add cursor decoding for paginated lists",
    scope_hint: ["api/pagination"],
    decomposer_partial_state: { active_intents: ["api/pagination"], edges: [] },
    intents_resolved_so_far: ["api/pagination"],
    intents_still_unresolved: ["api/pagination/cursor-window"],
    suggested_dialog_seed: "api/pagination/cursor-window",
    unresolved_refs: ["api/pagination/cursor-window"],
    created_at: "2026-06-10T00:00:00.000Z",
    last_touched_at: "2026-06-10T00:00:00.000Z",
  };

  test("canonical checkpoint parses", () => {
    expect(ImplementCheckpointSchema.parse(canonical)).toMatchObject({ schema_version: 1 });
  });

  test("suggested_dialog_seed is a plain string (Phase 3 naive content)", () => {
    expect(typeof ImplementCheckpointSchema.parse(canonical).suggested_dialog_seed).toBe("string");
  });

  test("decomposer_partial_state round-trips unknown keys verbatim (passthrough)", () => {
    const parsed = DecomposerPartialStateSchema.parse({ active_intents: [], edges: [], phase4_opaque: { x: 1 } });
    expect((parsed as Record<string, unknown>).phase4_opaque).toEqual({ x: 1 });
  });

  test("missing required field is rejected", () => {
    const { original_request, ...rest } = canonical;
    void original_request;
    expect(ImplementCheckpointSchema.safeParse(rest).success).toBe(false);
  });
});

describe("CancelResult (RFC App. A.11; design D9)", () => {
  test("canonical result parses and partitions", () => {
    const result = CancelResultSchema.parse({
      cancelled: {
        cancelled_worktrees: ["dusk/bd_20260610000000000"],
        partial_commits: [{ bead_id: "bd_20260610000000001", branch: "dusk/bd_20260610000000001", commit_sha: "abc123" }],
        cancelled_dialogs: [],
        cancelled_checkpoints: [],
        bead_memories_deleted: ["bd_20260610000000000"],
      },
      preserved: {
        already_committed: [{ bead_id: "bd_20260610000000002", commit_sha: "def456" }],
        in_flight_tasks_drained: 1,
      },
      trace_id: "tr_1",
      drain_duration_ms: 12,
    });
    expect(result.preserved.in_flight_tasks_drained).toBe(1);
    expect(result.cancelled.partial_commits).toHaveLength(1);
  });
});

describe("TestVerdict (RFC App. A.5)", () => {
  test("canonical verdict parses", () => {
    const v = TestVerdictSchema.parse({
      test_intent_path: "notifications/send/unit-tests",
      decision: "pass",
      per_triple: [
        { triple_id: "covers-persist-first", verdict: "pass", mapped_tests: ["persists before publishing"], rationale: "asserts ordering" },
      ],
      mapped_tests: ["persists before publishing"],
      rationale: "all covers-* triples satisfied",
      duration: 42,
    });
    expect(v.decision).toBe("pass");
  });
});

describe("TestVerifierLivelockReport (RFC §3.4.1)", () => {
  test("canonical report parses with all required fields", () => {
    const r = TestVerifierLivelockReportSchema.parse({
      bead_id: "bd_20260610000000000",
      test_intent_path: "notifications/send/unit-tests",
      failing_triple_id: "covers-persist-first",
      failing_triple: { subject: "the test", predicate: "verifies", object: "persistence precedes publish", polarity: "positive" },
      iterations_rejected: 3,
      engineer_attempts: [
        { approach_label: "mock-call-order", test_excerpt: "expect(order).toEqual(...)", verifier_rejection_summary: "predicate too weak", triple_slot_focus: "predicate" },
      ],
      verifier_persistent_rationale: {
        slot_focus_distribution: { predicate: 0.85, subject: 0.1, object: 0.05 },
        common_phrase: "does not actually assert ordering",
        full_rationales: ["..."],
        confidence: 0.9,
      },
      suggested_resolutions: [
        { verb: "accept_test_as_is", requires: "operator confirmation" },
        { verb: "modify_triple", requires: "an edited triple" },
        { verb: "escalate", requires: "nothing" },
      ],
    });
    expect(r.engineer_attempts[0].triple_slot_focus).toBe("predicate");
    expect(r.suggested_resolutions).toHaveLength(3);
  });
});

describe("CommitTrailers (RFC App. A.7; design D10)", () => {
  test("unconditional set parses; conditional fields optional", () => {
    const t = CommitTrailersSchema.parse({
      intents: [{ intent_path: "api/pagination", aspect_ids: ["cursor-decode"] }],
      test_intents: ["api/pagination/unit-tests"],
      bead_id: "bd_20260610000000000",
      verdict_id: "vd_1",
      trace_id: "tr_1",
      verifier_model: "claude-sonnet-4-6",
      long_cycle_samples: 10,
      test_suites_passed: 1,
    });
    expect(t.partial).toBeUndefined();
    expect(t.intents[0].aspect_ids).toEqual(["cursor-decode"]);
  });

  test("L1 partial path carries Partial + Deferred-Intent", () => {
    const t = CommitTrailersSchema.parse({
      intents: [{ intent_path: "api/a", aspect_ids: [] }],
      test_intents: [],
      bead_id: "bd_1",
      verdict_id: "vd_1",
      trace_id: "tr_1",
      verifier_model: "m",
      long_cycle_samples: 10,
      test_suites_passed: 0,
      partial: true,
      deferred_intents: ["api/b"],
    });
    expect(t.partial).toBe(true);
    expect(t.deferred_intents).toEqual(["api/b"]);
  });
});

describe("DuskError kinds (Phase-3 ladder + pause/resume + cancel)", () => {
  test("all Phase-3 kinds are pinned in the envelope", () => {
    for (const kind of [
      "decomposer_bead_conflict",
      "implement_paused_for_authoring",
      "implement_resume_token_expired",
      "bead_intent_revision_needed",
      "bead_frozen",
      "bead_aborted",
      "cancellation_already_committed",
    ]) {
      expect(DUSK_ERROR_KINDS).toContain(kind);
    }
  });
});
