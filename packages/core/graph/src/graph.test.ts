import { describe, test, expect } from "vitest";

import { IntentSchema, type Intent, type RelatesTo } from "@dusk/core-schema";

import { buildIntentGraph, detectRelatesToCycles } from "./graph.js";

function mk(id: string, relates_to: RelatesTo[] = []): Intent {
  return IntentSchema.parse({
    id,
    description: "d",
    obligation: "must",
    triples: [{ id: "t", subject: "s", predicate: "p", object: "o" }],
    relates_to,
  });
}
function mapOf(...intents: Intent[]): Map<string, Intent> {
  return new Map(intents.map((i) => [i.id, i]));
}

describe("detectRelatesToCycles (P1-T7)", () => {
  test("a relates_to cycle is detected and names the participants", () => {
    const a = mk("api/a", [{ kind: "parent", target: "api/b" }]);
    const b = mk("api/b", [{ kind: "sibling", target: "api/a" }]);
    const report = detectRelatesToCycles(mapOf(a, b));
    expect(report.hasCycle).toBe(true);
    expect(report.cycles[0]).toEqual(expect.arrayContaining(["api/a", "api/b"]));
  });

  test("an acyclic graph reports no cycle", () => {
    const child = mk("api/pagination/cursor-only", [{ kind: "parent", target: "api/pagination" }]);
    const parent = mk("api/pagination");
    expect(detectRelatesToCycles(mapOf(child, parent)).hasCycle).toBe(false);
  });
});

describe("IntentGraph traversal", () => {
  const parent = mk("api/pagination");
  const child = mk("api/pagination/cursor-only", [
    { kind: "parent", target: "api/pagination" },
    { kind: "sibling", target: "api/auth" },
  ]);
  const unit = mk("api/pagination/cursor-only/unit-tests", [{ kind: "parent", target: "api/pagination/cursor-only" }]);
  const graph = buildIntentGraph(mapOf(parent, child, unit));

  test("ancestors include parent edges and existing path segments", () => {
    expect(graph.ancestors("api/pagination/cursor-only")).toContain("api/pagination");
  });

  test("descendants are existing ids under the path", () => {
    expect(graph.descendants("api/pagination")).toContain("api/pagination/cursor-only");
  });

  test("relatedBy returns typed-edge targets", () => {
    expect(graph.relatedBy("api/pagination/cursor-only", "sibling")).toEqual(["api/auth"]);
  });

  test("test-pyramid children resolve for configured suffixes", () => {
    expect(graph.testPyramidChildren("api/pagination/cursor-only", ["unit-tests", "integration-tests"])).toEqual([
      "api/pagination/cursor-only/unit-tests",
    ]);
  });
});
