import { describe, test, expect } from "vitest";

import { loadIntent, type DecorationParseError } from "./loadIntent.js";

const base = { id: "api/x", description: "d", obligation: "must" };

describe("loadIntent negation enforcement (P1-T3 wiring)", () => {
  test("rejects matrix-predicate negation in a triple predicate slot", () => {
    const result = loadIntent({ ...base, triples: [{ id: "t", subject: "the type", predicate: "lacks", object: "a discriminator" }] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect((result.errors[0] as DecorationParseError).kind).toBe("decoration_parse_error");
    }
  });

  test("allows constituent negation in an object noun phrase", () => {
    const result = loadIntent({ ...base, triples: [{ id: "t", subject: "the function", predicate: "accept", object: "a request with no required arguments" }] });
    expect(result.success).toBe(true);
  });
});

describe("loadIntent antecedent grammar (P1-T4)", () => {
  const implies = (object: string, predicate = "is decorated with") => ({
    id: "api/idempotency-on-writes",
    description: "d",
    obligation: "must",
    compose: "implies",
    antecedent: [{ id: "a", subject: "the endpoint", predicate, object }],
    consequent: [{ id: "c", subject: "the endpoint", predicate: "validate", object: "an idempotency key" }],
  });

  test("rejects a behavioral antecedent predicate (closed-vocabulary violation)", () => {
    const result = loadIntent(implies("api/write-endpoint", "performs a database write"));
    expect(result.success).toBe(false);
  });

  test("rejects an unresolvable-shape antecedent object", () => {
    const result = loadIntent(implies("not a valid reference!!"));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => (e as DecorationParseError).kind === "decoration_parse_error")).toBe(true);
    }
  });

  test("accepts a decorator-fact antecedent against a resolvable reference", () => {
    expect(loadIntent(implies("api/write-endpoint")).success).toBe(true);
  });

  test("accepts an antecedent referencing a path with an aspect", () => {
    expect(loadIntent(implies("api/write-endpoint[is-write]")).success).toBe(true);
  });
});
