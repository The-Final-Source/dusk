import { createTempRepo, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { discoverTensionCandidates, framingKeywords, intentTreeCensus } from "./discovery.js";

const intentYaml = (id: string): string =>
  ["schema_version: 2", `id: ${id}`, `description: ${id} behavior`, "obligation: must", "compose: all", "triples:", "  - id: t1", "    subject: the system", "    predicate: does", "    object: the thing", ""].join("\n");

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
});
afterEach(() => repo.cleanup());

describe("Phase 6 §B — intent-tree census for prerequisite-tension detection (App. D.25)", () => {
  test("an empty intent tree reports is_empty (the canonical greenfield prerequisite case)", () => {
    const census = intentTreeCensus(repo.dir, ".ia/intents");
    expect(census.is_empty).toBe(true);
    expect(census.intent_paths).toEqual([]);
  });

  test("a missing .ia/intents directory is also an empty census (no crash)", () => {
    const census = intentTreeCensus(repo.dir, ".ia/intents/does-not-exist");
    expect(census.is_empty).toBe(true);
    expect(census.intent_paths).toEqual([]);
  });

  test("a populated tree reports the sorted census and is not empty", () => {
    repo.write(".ia/intents/notifications/create/intent.yaml", intentYaml("notifications/create"));
    repo.write(".ia/intents/app/db-client/intent.yaml", intentYaml("app/db-client"));
    const census = intentTreeCensus(repo.dir, ".ia/intents");
    expect(census.is_empty).toBe(false);
    expect(census.intent_paths).toEqual(["app/db-client", "notifications/create"]);
  });
});

describe("discovery helpers (unchanged)", () => {
  test("framingKeywords strips stopwords and short tokens", () => {
    expect(framingKeywords("add cursor pagination to the list")).toEqual(["cursor", "pagination", "list"]);
  });

  test("discoverTensionCandidates greps the tree for keyword hits", () => {
    repo.write(".ia/intents/api/pagination/intent.yaml", intentYaml("api/pagination"));
    const candidates = discoverTensionCandidates(repo.dir, ".ia/intents", "pagination cursor");
    expect(candidates.map((c) => c.path)).toContain("api/pagination");
  });
});
