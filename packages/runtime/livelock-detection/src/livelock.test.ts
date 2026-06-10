import { TestVerifierLivelockReportSchema } from "@dusk/core-schema";
import { describe, expect, test } from "vitest";

import { detectLivelock, type IterationObservation } from "./detector.js";
import { resolveTickPrecedence } from "./precedence.js";
import { resolveLivelock } from "./resolve.js";

const resolveTriple = () => ({ subject: "the test", predicate: "verifies", object: "persistence precedes publish", polarity: "positive" as const });

const obs = (iter: number, decision: "accept" | "reject", slot: "subject" | "predicate" | "object" | null, approach: string): IterationObservation => ({
  iter,
  test_intent_path: "notifications/send/unit-tests",
  triple_id: "covers-persist-first",
  decision,
  slot_focus: slot,
  approach_label: approach,
  test_excerpt: `excerpt-${iter}`,
  verifier_rationale: `does not actually assert ordering (iter ${iter})`,
});

describe("10.1 — three-condition detector", () => {
  test("all three conditions firing emits a schema-valid report", () => {
    const report = detectLivelock({
      beadId: "bd_20260610000000001",
      resolveTriple,
      observations: [
        obs(1, "reject", "predicate", "mock-call-order"),
        obs(2, "reject", "predicate", "spy-assertion"),
        obs(3, "reject", "predicate", "state-snapshot"),
      ],
    });
    expect(report).not.toBeNull();
    expect(TestVerifierLivelockReportSchema.safeParse(report).success).toBe(true);
    expect(report!.failing_triple_id).toBe("covers-persist-first");
    expect(report!.iterations_rejected).toBe(3);
    expect(report!.verifier_persistent_rationale.slot_focus_distribution.predicate).toBeCloseTo(1);
  });

  test("does NOT fire with <3 consecutive rejects", () => {
    const report = detectLivelock({
      beadId: "bd_1",
      resolveTriple,
      observations: [obs(1, "reject", "predicate", "a"), obs(2, "accept", "predicate", "b"), obs(3, "reject", "predicate", "c")],
    });
    expect(report).toBeNull();
  });

  test("does NOT fire when slot-focus concentration is below 80%", () => {
    const report = detectLivelock({
      beadId: "bd_1",
      resolveTriple,
      observations: [obs(1, "reject", "predicate", "a"), obs(2, "reject", "subject", "b"), obs(3, "reject", "object", "c")],
    });
    expect(report).toBeNull(); // 33% each — no single slot ≥80%
  });

  test("does NOT fire with <3 distinct approaches", () => {
    const report = detectLivelock({
      beadId: "bd_1",
      resolveTriple,
      observations: [obs(1, "reject", "predicate", "same"), obs(2, "reject", "predicate", "same"), obs(3, "reject", "predicate", "same")],
    });
    expect(report).toBeNull();
  });
});

const report = detectLivelock({
  beadId: "bd_20260610000000001",
  resolveTriple,
  observations: [
    obs(1, "reject", "predicate", "mock-call-order"),
    obs(2, "reject", "predicate", "spy-assertion"),
    obs(3, "reject", "predicate", "state-snapshot"),
  ],
})!;

describe("10.2 — dusk_resolve_livelock three-verb dispatch (P3-T18)", () => {
  test("accept_test_as_is → bypass instruction naming the failing triple", () => {
    const r = resolveLivelock(report, "accept_test_as_is");
    expect(r.success).toBe(true);
    if (!r.success || r.value.verb !== "accept_test_as_is") return;
    expect(r.value.bypass).toEqual({ test_intent_path: "notifications/send/unit-tests", triple_id: "covers-persist-first" });
  });

  test("modify_triple → opens a scoped Author dialog seeded from the failing triple (Phase-4 rewire)", () => {
    const r = resolveLivelock(report, "modify_triple");
    expect(r.success).toBe(true);
    if (!r.success || r.value.verb !== "modify_triple") return;
    expect(r.value.open_dialog.entry_mode).toBe("scoped_triple_edit");
    expect(r.value.open_dialog.dialog_init).toEqual({
      failing_triple: { subject: "the test", predicate: "verifies", object: "persistence precedes publish", polarity: "positive" },
      target_intent_path: "notifications/send/unit-tests",
      failing_triple_id: "covers-persist-first",
    });
  });

  test("escalate → freeze instruction", () => {
    const r = resolveLivelock(report, "escalate");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.verb).toBe("escalate");
  });
});

describe("10.3 — livelock-vs-budget precedence (P3-T28)", () => {
  test("when both fire, livelock wins (no exhaustion)", () => {
    const outcome = resolveTickPrecedence({ livelockReport: report, budgetExhausted: true });
    expect(outcome.kind).toBe("livelock");
  });

  test("budget exhaustion only when no livelock", () => {
    expect(resolveTickPrecedence({ livelockReport: null, budgetExhausted: true }).kind).toBe("budget_exhaustion");
    expect(resolveTickPrecedence({ livelockReport: null, budgetExhausted: false }).kind).toBe("continue");
  });
});
