import { describe, expect, test } from "vitest";

import {
  type BeadMemory,
  parseBeadMemory,
  recordApproach,
  serializeBeadMemory,
} from "./beadMemory.js";

// Task 3.2 — structured dual-channel bead memory format (round-trip + channels).

function populated(): BeadMemory {
  return {
    bead_id: "bd_2026052600001",
    role: "engineer",
    last_iter: 7,
    last_compacted_at_iter: 4,
    current_diagnosis: "covers-persist-first keeps failing; the ordering assertion is the blocker.",
    approaches_impl: [
      {
        approach_label: "extract-helper",
        attempted_at_iter: "1-3",
        triple_slot_focus: "predicate",
        summary: "extracted normalizeUserIds and decorated normalize-target",
        triple_id: "notifications/send[normalize-target]",
        focal_verdict: "pass",
      },
    ],
    approaches_test_authoring: [
      {
        approach_label: "time-spy",
        attempted_at_iter: "3-4",
        triple_slot_focus: "predicate",
        summary: "added Date.now spies",
      },
    ],
    verifier_signals: [
      {
        iter: 7,
        decision: "reject",
        triple_id: 'notifications/send/unit-tests[covers-persist-first] "the suite include ordering"',
        polarity: "positive",
        focal_verdict: "fail",
        support_quality: "ok",
        slot_focus: "predicate",
        approach_label: "mock-call-order",
        channel: "test-authoring",
        evidence_quote: "expect(insertSpy).toHaveBeenCalledBefore(publishSpy)",
      },
    ],
    intent_set_in_scope: ["notifications/send [persist-first, publish-sync-per-insert]"],
    files_being_modified: ["packages/api/src/services/notifications/index.ts"],
  };
}

describe("bead memory round-trip", () => {
  test("parse-then-serialize is byte-identical for a populated file", () => {
    const canonical = serializeBeadMemory(populated());
    const reparsed = serializeBeadMemory(parseBeadMemory(canonical));
    expect(reparsed).toBe(canonical);
  });

  test("a populated file carries all six named sections + frontmatter", () => {
    const text = serializeBeadMemory(populated());
    for (const heading of [
      "## Current diagnosis",
      "## Approaches tried (impl)",
      "## Approaches tried (test-authoring)",
      "## Verifier signals (last 3)",
      "## Intent set in scope",
      "## Files being modified",
    ]) {
      expect(text).toContain(heading);
    }
    expect(text.startsWith("---\nbead_id: bd_2026052600001")).toBe(true);
  });
});

describe("dual-channel recording", () => {
  test("a test-authoring approach lands in the test-authoring channel only", () => {
    const base = populated();
    const updated = recordApproach(base, "test-authoring", {
      approach_label: "mock-call-order",
      attempted_at_iter: "5",
      triple_slot_focus: "predicate",
      summary: "used vi.fn().mock.invocationCallOrder",
    });
    expect(updated.approaches_test_authoring.some((a) => a.approach_label === "mock-call-order")).toBe(true);
    expect(updated.approaches_impl.some((a) => a.approach_label === "mock-call-order")).toBe(false);

    // and it round-trips under the right heading
    const text = serializeBeadMemory(updated);
    const testSection = text.split("## Approaches tried (test-authoring)")[1].split("## Verifier signals")[0];
    expect(testSection).toContain("mock-call-order");
    const implSection = text.split("## Approaches tried (impl)")[1].split("## Approaches tried (test-authoring)")[0];
    expect(implSection).not.toContain("mock-call-order");
  });
});
