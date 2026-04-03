import { describe, it, expect } from "vitest";

import { IntentSchema, IntentDecisionSchema } from "./intent.js";

const validIntent = {
  id: "intent-todo-app",
  scope: "packages/todo",
  adopts: ["block-api-headers", "block-error-handling"],
};

describe("IntentSchema", () => {
  it("accepts a valid intent with all fields", () => {
    const full = {
      ...validIntent,
      decisions: [
        {
          point: "dp-001",
          choice: "lowercase",
          rationale: "Consistent with HTTP/2 conventions",
        },
      ],
      relates_to: [
        {
          target: "intent-auth",
          relationship: "depends-on",
          rationale: "Todo app requires authentication",
        },
      ],
      constraints: [
        {
          id: "ic-001",
          text: "All todo endpoints must require authentication",
          obligation: "must",
          verifiability: "mechanical",
        },
        {
          id: "ic-002",
          text: "Todo lists should support pagination",
          obligation: "should",
        },
      ],
    };

    const result = IntentSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("intent-todo-app");
      expect(result.data.decisions).toHaveLength(1);
      expect(result.data.relates_to).toHaveLength(1);
      expect(result.data.constraints).toHaveLength(2);
    }
  });

  it("accepts a minimal intent and applies defaults", () => {
    const result = IntentSchema.safeParse(validIntent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decisions).toEqual([]);
      expect(result.data.relates_to).toEqual([]);
      expect(result.data.constraints).toEqual([]);
    }
  });

  it("rejects duplicate constraint IDs", () => {
    const result = IntentSchema.safeParse({
      ...validIntent,
      constraints: [
        { id: "ic-001", text: "First constraint", obligation: "must" },
        { id: "ic-001", text: "Second constraint", obligation: "should" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const dupError = result.error.issues.find(
        (i) => i.message === "Constraint IDs must be unique within an intent",
      );
      expect(dupError).toBeDefined();
    }
  });

  it("rejects empty scope", () => {
    const result = IntentSchema.safeParse({ ...validIntent, scope: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty id", () => {
    const result = IntentSchema.safeParse({ ...validIntent, id: "" });
    expect(result.success).toBe(false);
  });

  it("accepts intent constraint without verifiability", () => {
    const result = IntentSchema.safeParse({
      ...validIntent,
      constraints: [
        { id: "ic-001", text: "Use structured logging", obligation: "should" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.constraints[0].verifiability).toBeUndefined();
    }
  });

  it("accepts intent constraint with verifiability", () => {
    const result = IntentSchema.safeParse({
      ...validIntent,
      constraints: [
        {
          id: "ic-001",
          text: "All responses must include request ID",
          obligation: "must",
          verifiability: "mechanical",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.constraints[0].verifiability).toBe("mechanical");
    }
  });

  it("accepts adopts with block IDs", () => {
    const result = IntentSchema.safeParse({
      id: "intent-feature",
      scope: "packages/feature",
      adopts: ["block-auth", "block-logging", "block-error-handling"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adopts).toHaveLength(3);
    }
  });
});

describe("IntentDecisionSchema", () => {
  it("accepts a decision with point and choice", () => {
    const result = IntentDecisionSchema.safeParse({
      point: "dp-001",
      choice: "redis",
      rationale: "Better for production workloads",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.point).toBe("dp-001");
      expect(result.data.choice).toBe("redis");
      expect(result.data.rationale).toBe("Better for production workloads");
    }
  });

  it("accepts a decision without rationale", () => {
    const result = IntentDecisionSchema.safeParse({
      point: "dp-002",
      choice: "in-memory",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rationale).toBeUndefined();
    }
  });
});
