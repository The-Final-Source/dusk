import { describe, test, expect } from "vitest";

import { TripleSchema, QuantifierSchema } from "./primitives.js";

describe("TripleSchema", () => {
  test("affirmative triple validates and polarity defaults to positive", () => {
    const triple = TripleSchema.parse({ id: "t1", subject: "s", predicate: "p", object: "o" });
    expect(triple.polarity).toBe("positive");
  });

  test("rejects unknown keys (e.g. a stray legacy `negated`)", () => {
    const result = TripleSchema.safeParse({ id: "t", subject: "s", predicate: "p", object: "o", negated: true });
    expect(result.success).toBe(false);
  });
});

describe("QuantifierSchema", () => {
  test.each(["at-least-one", "each", "exactly-one", "at-most-one", "none", "at-least-3", "at-most-12"])(
    "accepts %s",
    (value) => {
      expect(QuantifierSchema.safeParse(value).success).toBe(true);
    },
  );

  test.each(["at-least", "most-3", "sometimes", ""])("rejects %s", (value) => {
    expect(QuantifierSchema.safeParse(value).success).toBe(false);
  });
});
