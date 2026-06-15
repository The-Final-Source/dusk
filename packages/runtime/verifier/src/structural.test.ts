import { describe, test, expect } from "vitest";

import { IntentSchema, type Intent, type Verdict } from "@dusk/core-schema";
import { parseFileIntentSidecar } from "@dusk/core-decoration";
import { buildDerivedIndex } from "@dusk/core-index";

import { mergeStructuralSemantic, structuralVerdict } from "./structural.js";

function mk(id: string, aspectIds: string[]): Intent {
  return IntentSchema.parse({
    id,
    description: "d",
    obligation: "must",
    triples: aspectIds.map((aid) => ({ id: aid, subject: "s", predicate: "p", object: "o" })),
  });
}
const mapOf = (...intents: Intent[]): Map<string, Intent> => new Map(intents.map((i) => [i.id, i]));

const PKG = '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n';
const sidecar = (claims: unknown[]): string => JSON.stringify({ schema_version: 1, target: "package.json", claims });
const readerFor = (sidecarSource: string) => (f: string): string => {
  if (f === "package.json") return PKG;
  if (f === "package.json.intent") return sidecarSource;
  throw new Error(`unexpected read: ${f}`);
};
const indexFor = (sidecarSource: string, intent: Intent) =>
  buildDerivedIndex(parseFileIntentSidecar(sidecarSource, PKG, "package.json.intent", "package.json").records, mapOf(intent));

describe("structuralVerdict — zero-LLM mechanical satisfaction (RFC App. D.29)", () => {
  test("a fully-covered structural triple PASSES on the mechanical channel (converges iteration 1)", () => {
    const src = sidecar([{ anchor: "", marker: "intent-file", intent_path: "project/stack" }]);
    const intent = mk("project/stack", ["a"]);
    const res = structuralVerdict("project/stack", { index: indexFor(src, intent), intents: mapOf(intent), readFile: readerFor(src) });
    expect(res.success).toBe(true);
    const v = (res as { value: Verdict }).value;
    expect(v.decision).toBe("accept");
    expect(v.per_triple[0].focal_verdict).toBe("pass");
    expect(v.per_triple[0].channel).toBe("mechanical");
  });

  test("an uncovered non-trivial line FAILS the triple with an actionable rationale", () => {
    // Only /name is claimed → the "version" line is uncovered.
    const src = sidecar([{ anchor: "/name", marker: "intent", intent_path: "project/stack" }]);
    const intent = mk("project/stack", ["a"]);
    const res = structuralVerdict("project/stack", { index: indexFor(src, intent), intents: mapOf(intent), readFile: readerFor(src) });
    expect(res.success).toBe(true);
    const v = (res as { value: Verdict }).value;
    expect(v.decision).toBe("reject");
    expect(v.per_triple[0].focal_verdict).toBe("fail");
    expect(v.per_triple[0].rationale).toContain("uncovered");
  });

  test("a triple with NO structural claimant FAILS (uncovered aspect) rather than silently passing", () => {
    const intent = mk("project/stack", ["a"]);
    // empty record set → no structural claimant for "a"
    const res = structuralVerdict("project/stack", { index: buildDerivedIndex([], mapOf(intent)), intents: mapOf(intent), readFile: () => "" });
    expect(res.success).toBe(true);
    const v = (res as { value: Verdict }).value;
    expect(v.per_triple[0].focal_verdict).toBe("fail");
    expect(v.per_triple[0].rationale).toContain("no structural claimant");
  });

  test("an unresolvable intent path is a recoverable error", () => {
    const res = structuralVerdict("missing/intent", { index: buildDerivedIndex([], new Map()), intents: new Map(), readFile: () => "" });
    expect(res.success).toBe(false);
    expect((res as { error: { kind: string } }).error.kind).toBe("intent_path_unresolved");
  });
});

describe("mergeStructuralSemantic — mixed-intent per-triple combination", () => {
  const pt = (id: string, fv: "pass" | "fail", channel: "mechanical" | "semantic") => ({
    triple_id: id,
    focal_verdict: fv,
    channel,
    support_quality: "ok" as const,
    polarity: "positive" as const,
    evidence: { support_claims: [] },
    rationale: `${id}:${fv}`,
  });
  const verdict = (per_triple: ReturnType<typeof pt>[]): Verdict => ({
    intent_path: "x/y",
    decision: per_triple.some((t) => t.focal_verdict === "fail") ? "reject" : "accept",
    per_triple,
    aggregate_rationale: "r",
  });

  test("a triple claimed BOTH ways must pass both — structural fail overrides a semantic pass", () => {
    const structural = verdict([pt("both", "fail", "mechanical")]);
    const semantic = verdict([pt("both", "pass", "semantic")]);
    const merged = mergeStructuralSemantic(structural, semantic, new Set(["both"]), new Set(["both"]));
    expect(merged.per_triple[0].focal_verdict).toBe("fail");
    expect(merged.per_triple[0].channel).toBe("semantic");
    expect(merged.decision).toBe("reject");
  });

  test("structural-only and semantic-only triples each take their own channel's verdict", () => {
    const structural = verdict([pt("cfg", "pass", "mechanical"), pt("code", "fail", "mechanical")]);
    const semantic = verdict([pt("cfg", "fail", "semantic"), pt("code", "pass", "semantic")]);
    const merged = mergeStructuralSemantic(structural, semantic, new Set(["cfg"]), new Set(["code"]));
    const byId = new Map(merged.per_triple.map((t) => [t.triple_id, t]));
    expect(byId.get("cfg")?.focal_verdict).toBe("pass"); // structural-only → structural verdict
    expect(byId.get("cfg")?.channel).toBe("mechanical");
    expect(byId.get("code")?.focal_verdict).toBe("pass"); // semantic-only → semantic verdict
    expect(byId.get("code")?.channel).toBe("semantic");
    expect(merged.decision).toBe("accept");
  });
});
