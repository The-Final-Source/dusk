import { describe, test, expect } from "vitest";

import { DuskConfigSchema } from "@dusk/core-schema";

import { assembleEngineerTask, TEST_BEAD_SIGNAL } from "./stateMachine.js";

// D.32 / design D5 — the per-bead task signals a test bead when the primary
// intent is a test intent (authored suffix), and does NOT otherwise.
describe("assembleEngineerTask — per-bead test-bead signal (D5)", () => {
  const config = DuskConfigSchema.parse({});

  test("a test-suffix bead's task carries the test-bead signal naming the markers", () => {
    const task = assembleEngineerTask("app/notifications/unit-tests", config);
    expect(task).toContain("Implement app/notifications/unit-tests");
    expect(task).toContain(TEST_BEAD_SIGNAL);
    expect(task).toContain("@intent-test-file");
  });

  test("a non-test bead's task does NOT carry the signal", () => {
    const task = assembleEngineerTask("app/notifications/send", config);
    expect(task).toBe("Implement app/notifications/send");
    expect(task).not.toContain(TEST_BEAD_SIGNAL);
  });

  test("feedback is threaded through for both bead kinds", () => {
    expect(assembleEngineerTask("app/notifications/send", config, "fix the insert")).toBe("Implement app/notifications/send — fix the insert");
    expect(assembleEngineerTask("app/notifications/unit-tests", config, "cover the failure path")).toContain("— cover the failure path");
  });
});
