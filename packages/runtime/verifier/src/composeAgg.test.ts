import { describe, expect, test } from "vitest";

import { aggregateDecision } from "./composeAgg.js";

// Task 5.9 / P2-T16 — compose aggregation truth table.

describe("aggregateDecision", () => {
  const mixed = ["pass", "fail"] as const;
  const allPass = ["pass", "pass"] as const;
  const allFail = ["fail", "fail"] as const;

  test("all — rejects on any fail", () => {
    expect(aggregateDecision("all", allPass)).toBe("accept");
    expect(aggregateDecision("all", mixed)).toBe("reject");
  });

  test("any — accepts on any pass", () => {
    expect(aggregateDecision("any", mixed)).toBe("accept");
    expect(aggregateDecision("any", allFail)).toBe("reject");
  });

  test("none — rejects if any focal claim holds", () => {
    expect(aggregateDecision("none", allFail)).toBe("accept");
    expect(aggregateDecision("none", mixed)).toBe("reject");
  });

  test("implies — vacuous accept when antecedent false; else all over consequents", () => {
    expect(aggregateDecision("implies", mixed, { antecedentHeld: false })).toBe("accept");
    expect(aggregateDecision("implies", allPass, { antecedentHeld: true })).toBe("accept");
    expect(aggregateDecision("implies", mixed, { antecedentHeld: true })).toBe("reject");
  });
});
