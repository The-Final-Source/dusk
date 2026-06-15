import { describe, test, expect } from "vitest";

import { IntentSchema, type Intent } from "@dusk/core-schema";
import { parseDecorations, type DecorationRecord } from "@dusk/core-decoration";

import { buildDerivedIndex } from "./derivedIndex.js";

function mk(id: string, aspectIds: string[]): Intent {
  return IntentSchema.parse({
    id,
    description: "d",
    obligation: "must",
    triples: aspectIds.map((aid) => ({ id: aid, subject: "s", predicate: "p", object: "o" })),
  });
}
function mapOf(...intents: Intent[]): Map<string, Intent> {
  return new Map(intents.map((i) => [i.id, i]));
}

const DECORATED = `// @intent notifications/send [persist-first]
const inserted = db.insert();

// @intent-support notifications/send [persist-first] ["the row builder", "constructs", "rows"]
const rows = build();

// @intent notifications/send [publish-sync]
await pubsub.publish();
`;

describe("focal/support query (P1-T6)", () => {
  const records = parseDecorations(DECORATED, "x.ts");
  const index = buildDerivedIndex(records, mapOf(mk("notifications/send", ["persist-first", "publish-sync"])));

  test("returns only that aspect's focal + support claimants", () => {
    const { focal, support } = index.focalSupport("notifications/send", "persist-first");
    expect(focal).toHaveLength(1);
    expect(focal[0].line).toBe(1);
    expect(support).toHaveLength(1);
    expect(support[0].support_triple).toEqual(["the row builder", "constructs", "rows"]);
    // the publish-sync focal line is excluded
    expect(focal.some((r) => r.line === 8)).toBe(false);
  });

  test("forward and reverse queries", () => {
    expect(index.forward("notifications/send")).toHaveLength(3);
    expect(index.reverse("x.ts")).toEqual(["notifications/send"]);
  });

  test("aspectRollup reports unclaimed aspects", () => {
    // only persist-first and publish-sync are focally claimed; an intent with an extra aspect shows it unsatisfied
    const idx = buildDerivedIndex(parseDecorations(DECORATED, "x.ts"), mapOf(mk("notifications/send", ["persist-first", "publish-sync", "respect-opt-out"])));
    expect(idx.aspectRollup("notifications/send")).toEqual(["respect-opt-out"]);
  });
});

describe("hierarchical satisfaction (P1-T5)", () => {
  const parent = mk("notifications/send", ["normalize", "persist"]);
  const unit = mk("notifications/send/unit-tests", ["covers-persist"]);
  const index = buildDerivedIndex([], mapOf(parent, unit));

  test("an unsatisfied test child blocks parent satisfaction; satisfying it flips the parent", () => {
    const childUnsatisfied = (id: string) => id !== "notifications/send/unit-tests";
    const first = index.isSatisfied("notifications/send", childUnsatisfied);
    expect(first.satisfied).toBe(false);
    expect(first.unsatisfiedChildren).toContain("notifications/send/unit-tests");

    const allSatisfied = () => true;
    expect(index.isSatisfied("notifications/send", allSatisfied).satisfied).toBe(true);
  });
});

describe("configurable test-pyramid suffixes (P1-T17)", () => {
  test("a configured suffix resolves as a child and keys its test decorators by layer", () => {
    const records = parseDecorations(`// @intent-test api/x/contract-tests [covers-shape]\ntest("x", () => {});\n`, "x.test.ts");
    const index = buildDerivedIndex(records, mapOf(mk("api/x", ["a"]), mk("api/x/contract-tests", ["covers-shape"])));
    expect(index.graph.testPyramidChildren("api/x", ["unit-tests", "contract-tests"])).toEqual(["api/x/contract-tests"]);
    const byLayer = index.testChildrenByLayer("api/x", ["unit-tests", "contract-tests"]);
    expect(Object.keys(byLayer)).toEqual(["contract-tests"]);
    expect(byLayer["contract-tests"]).toHaveLength(1);
  });
});

// universal-decoration-coverage §7 / D6 — structural (comment-less) records are
// partitioned out of the semantic path at the index boundary, but stay visible
// to the non-semantic consumers (the keystone).
describe("D.28 — structural records partitioned from the semantic path", () => {
  const structural = (file: string, intentPath: string): DecorationRecord => ({
    file,
    line: 1,
    scope: "file",
    declaration_name: null,
    marker: "intent-file",
    intent_path: intentPath,
    aspect_ids: null,
    support_triple: null,
    ignore_clause: null,
    anchor: "",
    verify: "structural",
  });

  test("a structural intent-file claim does NOT flip a semantic aspect to satisfied", () => {
    const intent = mk("config/manifest", ["a"]);
    const withStructural = buildDerivedIndex([structural("package.json", "config/manifest")], mapOf(intent));
    const baseline = buildDerivedIndex([], mapOf(intent));
    // The aspect is still unclaimed — identical to having no record at all.
    expect(withStructural.aspectRollup("config/manifest")).toEqual(["a"]);
    expect(withStructural.aspectRollup("config/manifest")).toEqual(baseline.aspectRollup("config/manifest"));
    expect(withStructural.focalSupport("config/manifest", "a").focal).toHaveLength(0);
  });

  test("the structural record stays visible to reverse()/records but not semanticRecords (keystone preserved)", () => {
    const idx = buildDerivedIndex([structural("package.json", "config/manifest")], mapOf(mk("config/manifest", ["a"])));
    expect(idx.reverse("package.json")).toContain("config/manifest"); // dusk_inspect / reverse-index
    expect(idx.records.some((r) => r.verify === "structural")).toBe(true);
    expect(idx.semanticRecords.some((r) => r.verify === "structural")).toBe(false);
  });

  // D.29 — the channel classifiers that route the Verifier.
  test("structuralAspects reports the triple a structural claimant covers; semanticAspects does not", () => {
    const idx = buildDerivedIndex([structural("package.json", "config/manifest")], mapOf(mk("config/manifest", ["a"])));
    expect(idx.structuralAspects("config/manifest")).toEqual(["a"]);
    expect(idx.semanticAspects("config/manifest")).toEqual([]);
  });

  test("a mixed intent classifies each triple to its own channel", () => {
    // structural sidecar covers "cfg"; an inline semantic record covers "code".
    const semanticCode: DecorationRecord = {
      file: "src/x.ts",
      line: 1,
      scope: "declaration",
      declaration_name: null,
      marker: "intent",
      intent_path: "mixed/i",
      aspect_ids: ["code"],
      support_triple: null,
      ignore_clause: null,
    };
    const structuralCfg = { ...structural("package.json", "mixed/i"), aspect_ids: ["cfg"] };
    const idx = buildDerivedIndex([structuralCfg, semanticCode], mapOf(mk("mixed/i", ["cfg", "code"])));
    expect(idx.structuralAspects("mixed/i")).toEqual(["cfg"]);
    expect(idx.semanticAspects("mixed/i")).toEqual(["code"]);
  });
});
