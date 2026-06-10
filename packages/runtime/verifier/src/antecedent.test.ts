import type { DecorationRecord } from "@dusk/core-decoration";
import { buildDerivedIndex } from "@dusk/core-index";
import { IntentSchema, type Intent, type Verdict, type VerifierFactory } from "@dusk/core-schema";
import { describe, expect, test } from "vitest";

import { evaluateAntecedent, resolveUnit, type UnitUnderEvaluation } from "./antecedent.js";
import { verifyIntent } from "./procedure.js";

function rec(p: Partial<DecorationRecord> & Pick<DecorationRecord, "file" | "intent_path">): DecorationRecord {
  return {
    line: 1,
    scope: "declaration",
    declaration_name: "createUser",
    marker: "intent",
    aspect_ids: null,
    support_triple: null,
    ignore_clause: null,
    ...p,
  };
}

function impliesIntent(antecedent: unknown[]): Intent {
  return IntentSchema.parse({
    schema_version: 2,
    id: "api/idempotency-on-writes",
    description: "idempotency on write endpoints",
    obligation: "must",
    compose: "implies",
    antecedent,
    consequent: [{ id: "validates-idempotency", subject: "the endpoint", predicate: "validate", object: "an idempotency key" }],
  });
}

const indexOf = (records: DecorationRecord[]) => buildDerivedIndex(records, new Map());
const CREATE: UnitUnderEvaluation = { file: "a.ts", declarationName: "createUser" };
const GET: UnitUnderEvaluation = { file: "a.ts", declarationName: "getUser" };

describe("5.1 / P2-T6b — all three closed predicates evaluate by index lookup", () => {
  test("'is decorated with' — both directions", () => {
    const index = indexOf([rec({ file: "a.ts", declaration_name: "createUser", intent_path: "api/write-endpoint" })]);
    const intent = impliesIntent([{ id: "is-write", subject: "the endpoint", predicate: "is decorated with", object: "api/write-endpoint" }]);
    expect(evaluateAntecedent(intent, CREATE, index).held).toBe(true);
    expect(evaluateAntecedent(intent, GET, index).held).toBe(false);
  });

  test("'claims any aspect of' — both directions", () => {
    const index = indexOf([rec({ file: "a.ts", declaration_name: "createUser", intent_path: "api/write-endpoint", aspect_ids: ["x"] })]);
    const intent = impliesIntent([{ id: "claims", subject: "the endpoint", predicate: "claims any aspect of", object: "api/write-endpoint" }]);
    expect(evaluateAntecedent(intent, CREATE, index).held).toBe(true);
    expect(evaluateAntecedent(intent, GET, index).held).toBe(false);
  });

  test("'is enclosed by a decoration of' — file scope, both directions", () => {
    const index = indexOf([rec({ file: "a.ts", scope: "file", declaration_name: null, intent_path: "api/service-layer" })]);
    const intent = impliesIntent([{ id: "enclosed", subject: "the endpoint", predicate: "is enclosed by a decoration of", object: "api/service-layer" }]);
    expect(evaluateAntecedent(intent, CREATE, index).held).toBe(true);
    expect(evaluateAntecedent(intent, { file: "other.ts", declarationName: "x" }, index).held).toBe(false);
  });
});

describe("5.1 / P2-T6c — negative-polarity antecedent is a set-complement query", () => {
  test("NOT-decorated holds; decorated is false", () => {
    const intent = impliesIntent([
      { id: "not-legacy", subject: "the endpoint", predicate: "is decorated with", object: "api/legacy", polarity: "negative" },
    ]);
    const notLegacy = indexOf([rec({ file: "a.ts", declaration_name: "createUser", intent_path: "api/write-endpoint" })]);
    const legacy = indexOf([rec({ file: "a.ts", declaration_name: "createUser", intent_path: "api/legacy" })]);
    expect(evaluateAntecedent(intent, CREATE, notLegacy).held).toBe(true); // not decorated → antecedent holds
    expect(evaluateAntecedent(intent, CREATE, legacy).held).toBe(false); // decorated → false (vacuous accept)
  });
});

describe("5.1 / P2-T6 — no verifier call fires when the antecedent is false", () => {
  test("antecedent false → vacuous accept, factory never called; true → factory called once", async () => {
    let factoryCalls = 0;
    const factory: VerifierFactory = async () => {
      factoryCalls += 1;
      const v: Verdict = { intent_path: "api/idempotency-on-writes", decision: "reject", per_triple: [], aggregate_rationale: "" };
      return v;
    };
    const intent = impliesIntent([{ id: "is-write", subject: "the endpoint", predicate: "is decorated with", object: "api/write-endpoint" }]);

    // unit NOT decorated write-endpoint → antecedent false
    const falseIndex = indexOf([rec({ file: "a.ts", declaration_name: "createUser", intent_path: "api/idempotency-on-writes" })]);
    const vacuous = await verifyIntent(intent, { index: falseIndex, readFile: () => "", maxLines: 200, verifierFactory: factory, unit: CREATE });
    expect(vacuous.success).toBe(true);
    if (vacuous.success) {
      expect(vacuous.value.decision).toBe("accept");
      expect(vacuous.value.implies_antecedent_held).toBe(false);
      expect(vacuous.value.per_triple).toEqual([]);
    }
    expect(factoryCalls).toBe(0); // no Verifier call for the consequent

    // unit decorated write-endpoint → antecedent true → factory called
    const trueIndex = indexOf([rec({ file: "a.ts", declaration_name: "createUser", intent_path: "api/write-endpoint" })]);
    await verifyIntent(intent, { index: trueIndex, readFile: () => "", maxLines: 200, verifierFactory: factory, unit: CREATE });
    expect(factoryCalls).toBe(1);
  });
});

describe("5.2 / P2-T7b — ambiguous antecedent is a structural error, never an LLM fallback", () => {
  test("subject binding to multiple units returns verifier_evidence_too_large", () => {
    const index = indexOf([
      rec({ file: "a.ts", declaration_name: "createUser", intent_path: "api/idempotency-on-writes" }),
      rec({ file: "a.ts", declaration_name: "updateUser", intent_path: "api/idempotency-on-writes" }),
    ]);
    const result = resolveUnit("api/idempotency-on-writes", index);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.kind).toBe("verifier_evidence_too_large");
  });

  test("verifyIntent surfaces the ambiguity without calling the factory", async () => {
    let factoryCalls = 0;
    const factory: VerifierFactory = async () => {
      factoryCalls += 1;
      return { intent_path: "x", decision: "accept", per_triple: [], aggregate_rationale: "" };
    };
    const index = indexOf([
      rec({ file: "a.ts", declaration_name: "createUser", intent_path: "api/idempotency-on-writes" }),
      rec({ file: "a.ts", declaration_name: "updateUser", intent_path: "api/idempotency-on-writes" }),
    ]);
    const intent = impliesIntent([{ id: "is-write", subject: "the endpoint", predicate: "is decorated with", object: "api/write-endpoint" }]);
    const result = await verifyIntent(intent, { index, readFile: () => "", maxLines: 200, verifierFactory: factory });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.kind).toBe("verifier_evidence_too_large");
    expect(factoryCalls).toBe(0);
  });
});
