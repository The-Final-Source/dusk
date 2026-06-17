import { describe, expect, test } from "vitest";

import { findIllegalNegation } from "./negationDetector.js";
import {
  validateAntecedentGrammar,
  validateAtomicIntent,
  validateMatrixPredicateNegation,
  validateRelatesToKinds,
  validateVerifyChannel,
} from "./validate.js";

describe("validateVerifyChannel — structural channel honesty (RFC App. D.31)", () => {
  test("verify: structural + polarity: negative is rejected", () => {
    const v = validateVerifyChannel({ id: "no-x", verify: "structural", polarity: "negative" });
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe("verify_channel");
    expect(v[0].message).toContain("absence");
  });

  test("verify: structural + a quantifier is rejected", () => {
    const v = validateVerifyChannel({ id: "one-x", verify: "structural", quantifier: "at-most-one" });
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("cardinality");
  });

  test("verify: structural + positive + no quantifier is fine", () => {
    expect(validateVerifyChannel({ id: "shape", verify: "structural", polarity: "positive" })).toEqual([]);
  });

  test("a semantic (or unset) triple is never constrained — negatives/quantifiers are legal there", () => {
    expect(validateVerifyChannel({ id: "x", verify: "semantic", polarity: "negative", quantifier: "none" })).toEqual([]);
    expect(validateVerifyChannel({ id: "x", polarity: "negative" })).toEqual([]);
  });
});

/**
 * Delegation-pinning tests (arch-board S3): each Stage-4.5 named entry point
 * must agree with the Phase-1 single-source leaf it adapts — a known-bad input
 * rejected by the leaf yields the corresponding ValidationViolation; a
 * known-good input yields none. Phase 5's audit relies on this equivalence.
 */

describe("validateMatrixPredicateNegation ≡ the Phase-1 negation leaf", () => {
  test("a matrix-negated predicate the leaf rejects yields the violation with the leaf's marker", () => {
    const triple = { id: "t1", subject: "list endpoints", predicate: "does not use", object: "offset pagination" };
    const leaf = findIllegalNegation("predicate", triple.predicate);
    expect(leaf?.marker).toBe("does not");
    const violations = validateMatrixPredicateNegation(triple);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: "matrix_predicate_negation", path: "triples.t1.predicate" });
    expect(violations[0].message).toContain('"does not"');
  });

  test("constituent negation in the object slot is legal in both surfaces", () => {
    const triple = { id: "t2", subject: "the sandbox", predicate: "provide", object: "an environment free of network access" };
    expect(findIllegalNegation("object", triple.object)).toBeNull();
    expect(validateMatrixPredicateNegation(triple)).toEqual([]);
  });
});

describe("validateAntecedentGrammar ≡ closed vocabulary + resolvable references", () => {
  test("a behavioral predicate outside the closed vocabulary is rejected", () => {
    const violations = validateAntecedentGrammar({
      compose: "implies",
      antecedent: [{ id: "a1", subject: "the endpoint", predicate: "performs a write", object: "api/write-endpoint" }],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("antecedent_grammar");
    expect(violations[0].message).toContain("closed vocabulary");
  });

  test("an unresolvable free-text object is rejected; a clean antecedent passes", () => {
    const bad = validateAntecedentGrammar({
      compose: "implies",
      antecedent: [{ id: "a1", subject: "the endpoint", predicate: "is decorated with", object: "Some Free Text!" }],
    });
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain("resolvable reference");

    const good = validateAntecedentGrammar({
      compose: "implies",
      antecedent: [{ id: "a1", subject: "the endpoint", predicate: "is decorated with", object: "api/write-endpoint" }],
    });
    expect(good).toEqual([]);
  });
});

describe("validateRelatesToKinds ≡ the five typed kinds", () => {
  test("refines is rejected; the five kinds pass", () => {
    expect(validateRelatesToKinds({ relates_to: [{ kind: "refines", target: "api/x" }] })).toHaveLength(1);
    expect(
      validateRelatesToKinds({
        relates_to: ["parent", "implies", "conflicts", "supersedes", "sibling"].map((kind) => ({ kind, target: "api/x" })),
      }),
    ).toEqual([]);
  });
});

describe("validateAtomicIntent ≡ loadIntent (full v2 schema + parser rules)", () => {
  const clean = {
    schema_version: 2,
    id: "api/widget",
    description: "Widget endpoint returns typed widgets.",
    obligation: "must",
    compose: "all",
    triples: [{ id: "shape", subject: "the widget endpoint", predicate: "return", object: "a typed widget" }],
  };

  test("a clean v2 intent loads; a negated predicate fails with the parser's decoration_parse_error", () => {
    expect(validateAtomicIntent(clean).success).toBe(true);
    const negated = { ...clean, triples: [{ ...clean.triples[0], predicate: "does not return" }] };
    const result = validateAtomicIntent(negated);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((e) => "kind" in e && e.kind === "decoration_parse_error")).toBe(true);
  });
});
