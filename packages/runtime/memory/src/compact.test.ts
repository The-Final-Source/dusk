import { describe, expect, test } from "vitest";

import { type BeadMemory, type VerifierSignal, serializeBeadMemory } from "./beadMemory.js";
import { compact } from "./compact.js";

// Task 3.3 — compaction is a pure, deterministic transform (unit-only).

function signal(iter: number, channel: "impl" | "test-authoring"): VerifierSignal {
  return {
    iter,
    decision: "reject",
    triple_id: `notifications/send[aspect-${iter}]`,
    polarity: "positive",
    focal_verdict: iter % 2 === 0 ? "pass" : "fail",
    support_quality: "ok",
    slot_focus: "predicate",
    approach_label: `approach-${iter}`,
    channel,
    evidence_quote: `quote-${iter}`,
    rationale: `VERBOSE-RATIONALE-${iter} that should be dropped on compaction`,
  };
}

function memoryWith(signals: VerifierSignal[]): BeadMemory {
  return {
    bead_id: "bd_1",
    role: "engineer",
    last_iter: signals.at(-1)?.iter ?? 0,
    last_compacted_at_iter: 0,
    current_diagnosis: "",
    approaches_impl: [],
    approaches_test_authoring: [],
    verifier_signals: signals,
    intent_set_in_scope: [],
    files_being_modified: [],
  };
}

describe("compact", () => {
  test("no-op when ≤ 3 signals", () => {
    const m = memoryWith([signal(1, "impl"), signal(2, "impl"), signal(3, "impl")]);
    expect(compact(m)).toEqual(m);
  });

  test("5→3 keeps the most recent three verbatim and folds the older two", () => {
    const signals = [
      signal(1, "impl"),
      signal(2, "test-authoring"),
      signal(3, "impl"),
      signal(4, "impl"),
      signal(5, "test-authoring"),
    ];
    const out = compact(memoryWith(signals));

    // kept: the three highest iters, verbatim
    expect(out.verifier_signals.map((s) => s.iter)).toEqual([3, 4, 5]);
    expect(out.verifier_signals).toContainEqual(signals[2]);

    // folded: iter 1 (impl) and iter 2 (test-authoring) into their channels
    const foldedImpl = out.approaches_impl.find((a) => a.attempted_at_iter === "1");
    const foldedTest = out.approaches_test_authoring.find((a) => a.attempted_at_iter === "2");
    expect(foldedImpl).toBeDefined();
    expect(foldedTest).toBeDefined();

    // load-bearing facts preserved
    expect(foldedImpl!.approach_label).toBe("approach-1");
    expect(foldedImpl!.triple_slot_focus).toBe("predicate");
    expect(foldedImpl!.triple_id).toBe("notifications/send[aspect-1]");
    expect(foldedImpl!.focal_verdict).toBe("fail");

    // folded approaches carry no rationale, and the persisted file drops all
    // verbose rationale (serialization never writes the rationale channel).
    expect(foldedImpl!.summary).not.toContain("VERBOSE-RATIONALE");
    expect(serializeBeadMemory(out)).not.toContain("VERBOSE-RATIONALE");
    expect(out.last_compacted_at_iter).toBe(3);
  });
});
