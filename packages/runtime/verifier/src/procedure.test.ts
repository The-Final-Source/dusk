import type { DecorationRecord } from "@dusk/core-decoration";
import { buildDerivedIndex } from "@dusk/core-index";
import { IntentSchema, type Intent } from "@dusk/core-schema";
import { describe, expect, test } from "vitest";

import { type ModelClient, type ModelResponse } from "./modelClient.js";
import { verifyIntent } from "./procedure.js";

/**
 * Deterministic, structural verification of the full procedure assembly
 * (polarity inversion + verdict split + support_pass_count + compose) using a
 * FAKE model client. Verdict CORRECTNESS against the real model is the gated
 * procedure.real.test.ts; this proves the runtime wiring around the model.
 */
function fakeModel(response: ModelResponse): ModelClient & { calls: number } {
  const client = {
    calls: 0,
    async complete() {
      client.calls += 1;
      return { text: JSON.stringify(response), usage: { model: "fake", promptTokens: 10, completionTokens: 5, costUsd: 0, latencyMs: 1 } };
    },
  };
  return client;
}

function rec(p: Partial<DecorationRecord> & Pick<DecorationRecord, "file" | "intent_path" | "marker">): DecorationRecord {
  return { line: 1, scope: "statement", declaration_name: null, aspect_ids: null, support_triple: null, ignore_clause: null, ...p };
}

const SOURCE = ["// @intent svc/q [a]", "const x = run();", "// @intent-support svc/q [a] [\"s\",\"p\",\"o\"]", "const y = run2();"].join("\n");
const readFile = () => SOURCE;

function fixture(polarity: "positive" | "negative", supports: number) {
  const records: DecorationRecord[] = [
    rec({ file: "svc.ts", intent_path: "svc/q", marker: "intent", aspect_ids: ["a"], line: 1 }),
  ];
  for (let i = 0; i < supports; i += 1) {
    records.push(rec({ file: "svc.ts", intent_path: "svc/q", marker: "intent-support", aspect_ids: ["a"], line: 3, support_triple: ["s", "p", `o${i}`] }));
  }
  const intent: Intent = IntentSchema.parse({
    id: "svc/q",
    description: "d",
    obligation: "must",
    compose: "all",
    triples: [{ id: "a", subject: "the code", predicate: "does", object: "the thing", polarity }],
  });
  return { intent, index: buildDerivedIndex(records, new Map([["svc/q", intent]])) };
}

// App. D.34 / R8 — require positive success evidence; never infer a verdict from
// silence. The confirmed live trigger: a degraded response silently coerced into a
// definite verdict (the former `?? false` / `?? "vague"`).
describe("verifyIntent — positive completeness (no verdict from silence)", () => {
  test("a degraded {triples:[]} under a non-empty triple set ⇒ no_verdict, never a false-converge", async () => {
    const { intent, index } = fixture("positive", 0);
    const model = fakeModel({ triples: [] });
    const result = await verifyIntent(intent, { index, readFile, maxLines: 200, modelClient: model });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected no_verdict");
    expect(result.error.kind).toBe("infrastructure_no_verdict");
    expect(result.error.recoverable).toBe(true);
  });

  test("a response missing a scoped support entry ⇒ no_verdict (incomplete), not a fabricated 'vague'", async () => {
    const { intent, index } = fixture("positive", 1);
    // covers the triple but omits the support id "a-s1"
    const model = fakeModel({ triples: [{ triple_id: "a", affirmative_holds: true, rationale: "", supports: [] }] });
    const result = await verifyIntent(intent, { index, readFile, maxLines: 200, modelClient: model });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected no_verdict");
    expect(result.error.kind).toBe("infrastructure_no_verdict");
  });
});

describe("verifyIntent — runtime polarity inversion (structural)", () => {
  test("negative polarity inverts a model 'affirmative holds' into a focal fail", async () => {
    const { intent, index } = fixture("negative", 0);
    const model = fakeModel({ triples: [{ triple_id: "a", affirmative_holds: true, rationale: "", supports: [] }] });
    const result = await verifyIntent(intent, { index, readFile, maxLines: 200, modelClient: model });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.per_triple[0].focal_verdict).toBe("fail"); // affirmative holds + negative → fail
    expect(result.value.per_triple[0].polarity).toBe("negative");
    expect(result.value.decision).toBe("reject");
  });
});

describe("verifyIntent — verdict split + support summary (structural)", () => {
  test("a mismatched support lowers support_quality without failing the focal claim", async () => {
    const { intent, index } = fixture("positive", 1);
    const model = fakeModel({ triples: [{ triple_id: "a", affirmative_holds: true, rationale: "", supports: [{ id: "a-s1", triple_verdict: "mismatch" }] }] });
    const result = await verifyIntent(intent, { index, readFile, maxLines: 200, modelClient: model });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const t = result.value.per_triple[0];
    expect(t.focal_verdict).toBe("pass");
    expect(t.support_quality).toBe("low_confidence");
    expect(t.evidence.support_claims[0].triple_verdict).toBe("mismatch");
  });

  test("passing supports are summarized as support_pass_count, not enumerated", async () => {
    const { intent, index } = fixture("positive", 3);
    const model = fakeModel({
      triples: [{ triple_id: "a", affirmative_holds: true, rationale: "", supports: [
        { id: "a-s1", triple_verdict: "matches" },
        { id: "a-s2", triple_verdict: "matches" },
        { id: "a-s3", triple_verdict: "matches" },
      ] }],
    });
    const result = await verifyIntent(intent, { index, readFile, maxLines: 200, modelClient: model });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const t = result.value.per_triple[0];
    expect(t.evidence.support_pass_count).toBe(3);
    expect(t.evidence.support_claims).toEqual([]); // only failed/low-confidence enumerated
    expect(t.support_quality).toBe("ok");
  });
});
