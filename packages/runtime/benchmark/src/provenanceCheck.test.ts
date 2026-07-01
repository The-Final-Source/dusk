import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Intent } from "@dusk/core-schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkProvenance, readAuthorTraceIds, readFinalizeCreatedIds } from "./provenanceCheck.js";

// Phase-6 §5.3 — the transcript/provenance checker (design D6). Zero-model pure
// pass. Unit-tested against a small intents fixture + a `traces.jsonl` fixture,
// plus an orphaned-intent negative case.

const intent = (over: Partial<Intent> & Pick<Intent, "id">): Intent => ({
  schema_version: 2,
  description: "fixture intent",
  obligation: "must",
  compose: "all",
  relates_to: [],
  triples: [{ id: "t1", subject: "s", predicate: "p", object: "o", polarity: "positive" }],
  ...over,
});

/** A small but spec-complete tree: a negative triple, a closed-vocab implies, and all three pyramid layers. */
function fixtureTree(): Map<string, Intent> {
  const entries: Intent[] = [
    intent({ id: "api/notifications/list" }),
    intent({
      id: "api/notifications/no-pii-in-logs",
      triples: [{ id: "neg", subject: "log line", predicate: "contains", object: "pii", polarity: "negative" }],
    }),
    intent({
      id: "api/notifications/idempotent-write",
      compose: "implies",
      triples: undefined,
      antecedent: [{ id: "a1", subject: "handler", predicate: "is decorated with", object: "api/write", polarity: "positive" }],
      consequent: [{ id: "c1", subject: "duplicate key", predicate: "yields", object: "single effect", polarity: "positive" }],
    }),
    intent({ id: "api/notifications/list/unit-tests" }),
    intent({ id: "api/notifications/list/integration-tests" }),
    intent({ id: "api/notifications/idempotent-write/e2e-tests" }),
  ];
  return new Map(entries.map((i) => [i.id, i]));
}

describe("checkProvenance — durable-record provenance (D6)", () => {
  it("passes when every intent has an author trace + finalize record, and the required constructs exist", () => {
    const intents = fixtureTree();
    const ids = new Set(intents.keys());
    const result = checkProvenance({ intents, authorTracedIntentIds: ids, finalizeCreatedIntentIds: ids });
    expect(result.pass).toBe(true);
    expect(result.intents_checked).toBe(6);
    expect(result.has_negative_polarity).toBe(true);
    expect(result.has_closed_vocab_implies).toBe(true);
    expect(result.pyramid_layers_present).toEqual(["e2e-tests", "integration-tests", "unit-tests"]);
    expect(result.violations).toEqual([]);
  });

  it("fails and names an intent with no correlating author trace (orphaned-intent negative case)", () => {
    const intents = fixtureTree();
    const all = new Set(intents.keys());
    const missingAuthor = new Set([...all].filter((id) => id !== "api/notifications/list"));
    const result = checkProvenance({ intents, authorTracedIntentIds: missingAuthor, finalizeCreatedIntentIds: all });
    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual({ kind: "orphaned_intent_no_author_trace", intent_id: "api/notifications/list" });
  });

  it("fails and names an intent with no finalize record", () => {
    const intents = fixtureTree();
    const all = new Set(intents.keys());
    const missingFinalize = new Set([...all].filter((id) => id !== "api/notifications/idempotent-write"));
    const result = checkProvenance({ intents, authorTracedIntentIds: all, finalizeCreatedIntentIds: missingFinalize });
    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual({ kind: "orphaned_intent_no_finalize_record", intent_id: "api/notifications/idempotent-write" });
  });

  it("fails when a required construct is absent (no negative triple, no implies, missing a pyramid layer)", () => {
    const sparse = new Map<string, Intent>([
      ["api/x", intent({ id: "api/x" })],
      ["api/x/unit-tests", intent({ id: "api/x/unit-tests" })],
    ]);
    const ids = new Set(sparse.keys());
    const result = checkProvenance({ intents: sparse, authorTracedIntentIds: ids, finalizeCreatedIntentIds: ids });
    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual({ kind: "missing_negative_polarity_triple" });
    expect(result.violations).toContainEqual({ kind: "missing_closed_vocab_implies" });
    expect(result.violations).toContainEqual({ kind: "missing_pyramid_layer", layer: "integration-tests" });
    expect(result.violations).toContainEqual({ kind: "missing_pyramid_layer", layer: "e2e-tests" });
  });
});

describe("readAuthorTraceIds / readFinalizeCreatedIds — the real-artifact seams", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dusk-prov-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const trace = (over: Record<string, unknown>): string =>
    JSON.stringify({
      schema_version: 1,
      trace_id: "t",
      role: "author",
      invocation_site: "author",
      model: "claude-opus-4",
      prompt_tokens: 1,
      completion_tokens: 1,
      latency_ms: 1,
      cost_usd: 0,
      ...over,
    });

  it("harvests authored intent ids from `role: author` traces, ignoring other roles", () => {
    const tracesPath = join(root, "traces.jsonl");
    writeFileSync(
      tracesPath,
      [
        trace({ output_summary: { intents_created: ["api/a", "api/a/unit-tests"] } }),
        trace({ role: "verifier", invocation_site: "short-cycle", output_summary: { intents_created: ["should-be-ignored"] } }),
        trace({ output_summary: { intent_id: "api/b" } }),
        "not json",
        "",
      ].join("\n"),
      "utf8",
    );
    const ids = readAuthorTraceIds(tracesPath);
    expect(ids).toEqual(new Set(["api/a", "api/a/unit-tests", "api/b"]));
  });

  it("reads the union of finalize `intents_created` records from a JSONL", () => {
    const path = join(root, "finalize.jsonl");
    writeFileSync(path, [JSON.stringify({ intents_created: ["api/a"] }), JSON.stringify({ intents_created: ["api/b", "api/a"] }), ""].join("\n"), "utf8");
    expect(readFinalizeCreatedIds(path)).toEqual(new Set(["api/a", "api/b"]));
  });

  it("missing files read as empty sets (honest, never throws)", () => {
    expect(readAuthorTraceIds(join(root, "nope.jsonl"))).toEqual(new Set());
    expect(readFinalizeCreatedIds(join(root, "nope.jsonl"))).toEqual(new Set());
  });
});
