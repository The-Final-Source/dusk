import { describe, test, expect } from "vitest";

import { IntentSchema } from "./intent.js";

const base = { id: "api/pagination", description: "d", obligation: "must" } as const;
const triple = { id: "t", subject: "s", predicate: "p", object: "o" };

describe("IntentSchema", () => {
  test("a valid compose: all intent validates with defaults applied", () => {
    const intent = IntentSchema.parse({ ...base, triples: [triple] });
    expect(intent.compose).toBe("all");
    expect(intent.schema_version).toBe(2);
    expect(intent.relates_to).toEqual([]);
  });

  test("compose: implies requires non-empty antecedent and consequent groups", () => {
    const antecedent = [{ id: "a", subject: "the endpoint", predicate: "is decorated with", object: "api/write-endpoint" }];
    const consequent = [{ id: "c", subject: "the endpoint", predicate: "validate", object: "an idempotency key" }];
    expect(IntentSchema.safeParse({ ...base, compose: "implies", antecedent }).success).toBe(false);
    expect(IntentSchema.safeParse({ ...base, compose: "implies", antecedent, consequent }).success).toBe(true);
  });

  test("a non-implies intent rejects antecedent/consequent groups", () => {
    const result = IntentSchema.safeParse({
      ...base,
      triples: [triple],
      antecedent: [{ id: "a", subject: "x", predicate: "is decorated with", object: "y" }],
    });
    expect(result.success).toBe(false);
  });

  test("an antecedent predicate outside the closed vocabulary is rejected", () => {
    const result = IntentSchema.safeParse({
      ...base,
      compose: "implies",
      antecedent: [{ id: "a", subject: "the endpoint", predicate: "performs a database write", object: "x" }],
      consequent: [{ id: "c", subject: "s", predicate: "p", object: "o" }],
    });
    expect(result.success).toBe(false);
  });

  test("duplicate triple ids are rejected", () => {
    const result = IntentSchema.safeParse({
      ...base,
      triples: [triple, { id: "t", subject: "s2", predicate: "p2", object: "o2" }],
    });
    expect(result.success).toBe(false);
  });

  test("a non-path id is rejected", () => {
    expect(IntentSchema.safeParse({ ...base, id: "Not A Path!", triples: [triple] }).success).toBe(false);
  });
});
