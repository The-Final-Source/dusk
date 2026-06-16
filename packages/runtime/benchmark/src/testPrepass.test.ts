import { describe, test, expect } from "vitest";

import { IntentSchema, type Intent } from "@dusk/core-schema";
import { parseDecorations } from "@dusk/core-decoration";
import { buildDerivedIndex } from "@dusk/core-index";
import type { ModelClient } from "@dusk/runtime-verifier";

import { realTestPrepassVerdict } from "./testPrepass.js";

// D.32 / design D3 — a routed test intent with no discoverable body fails loud
// and legibly, BEFORE the model call (an empty body sent to the model could
// return `true` → a silent accept).

const mkIntent = (id: string): Intent =>
  IntentSchema.parse({
    id,
    description: "d",
    obligation: "must",
    triples: [{ id: "a", subject: "s", predicate: "p", object: "o" }],
  });

// A model client that records how many times it was called — proves the guard
// pre-empts the model.
function recordingModelClient(): { client: ModelClient; calls: () => number } {
  let calls = 0;
  const client: ModelClient = {
    async complete() {
      calls += 1;
      return { text: '{"triples":[{"triple_id":"a","genuinely_verifies":true,"rationale":"x"}]}', usage: { model: "m", promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 0 } };
    },
  };
  return { client, calls: () => calls };
}

describe("realTestPrepassVerdict — fail loud on a missing test body (D3)", () => {
  test("a test intent with NO test-marker claimant fails test_intent_no_test_marker with no model call", async () => {
    const intentPath = "app/notifications/unit-tests";
    // The test file claims the intent with the focal, non-test `@intent` marker,
    // so testDiscovery is empty — the silent-accept scenario.
    const records = parseDecorations(`// @intent ${intentPath} [a]\nexport const t = 1;\n`, "x.test.ts");
    const index = buildDerivedIndex(records, new Map([[intentPath, mkIntent(intentPath)]]));
    const rec = recordingModelClient();

    const result = await realTestPrepassVerdict(intentPath, {
      index,
      intents: new Map([[intentPath, mkIntent(intentPath)]]),
      readFile: () => "",
      modelClient: rec.client,
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error.kind).toBe("test_intent_no_test_marker");
    expect(result.error.recoverable).toBe(true);
    expect(result.error.message).toContain(intentPath);
    expect(result.error.message).toContain("@intent-test-file");
    expect(rec.calls()).toBe(0); // the guard pre-empted the model — no silent accept possible
  });

  test("a test intent WITH a test-marker body proceeds to the model", async () => {
    const intentPath = "app/notifications/unit-tests";
    const records = parseDecorations(`// @intent-test-file ${intentPath}\nexport const t = 1;\n`, "x.test.ts");
    const index = buildDerivedIndex(records, new Map([[intentPath, mkIntent(intentPath)]]));
    const rec = recordingModelClient();

    const result = await realTestPrepassVerdict(intentPath, {
      index,
      intents: new Map([[intentPath, mkIntent(intentPath)]]),
      readFile: () => "test('t', () => expect(send()).toBe(1));",
      modelClient: rec.client,
    });

    expect(result.success).toBe(true);
    expect(rec.calls()).toBe(1);
  });
});
