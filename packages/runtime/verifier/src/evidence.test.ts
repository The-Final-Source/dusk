import { loadWorkedExample } from "@dusk/fixtures";
import { describe, expect, test } from "vitest";

import { assembleEvidence } from "./evidence.js";

// Task 5.3 / P2-T10 — scoped reading reads focal + named-support evidence only.

describe("assembleEvidence", () => {
  test("reads only the aspect's claimant lines, not the whole body", () => {
    const wx = loadWorkedExample();
    const result = assembleEvidence("notifications/send", "publish-sync-per-insert", wx.index, wx.readFile, 200);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const text = JSON.stringify(result.value);

    // present: the publish line + loop / timestamp / event-payload supports
    expect(text).toContain("pubsub.publish(notificationChannel, event)");
    expect(text).toContain("for (const notification of inserted)");
    expect(text).toContain("Date.now()");
    expect(text).toContain("const event");

    // absent: opt-out, push-dispatch, error-handling lines (other aspects)
    expect(text).not.toContain("pushAdapter.sendBatch");
    expect(text).not.toContain("optOutTargetPredicate");
    expect(text).not.toContain("logger.error");
  });

  test("evidence overflow returns a structural error, never silent truncation", () => {
    const wx = loadWorkedExample();
    const result = assembleEvidence("notifications/send", "respect-opt-out", wx.index, wx.readFile, 2);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.kind).toBe("verifier_evidence_too_large");
  });
});
