import { describe, test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadIntentTree } from "./loadIntents.js";

function writeIntent(root: string, id: string, declaredId: string): void {
  const dir = join(root, ...id.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "intent.yaml"),
    `id: ${declaredId}\ndescription: d\nobligation: must\ntriples:\n  - id: t\n    subject: s\n    predicate: p\n    object: o\n`,
  );
}

describe("loadIntentTree", () => {
  test("resolves each intent id from its directory path", () => {
    const root = mkdtempSync(join(tmpdir(), "dusk-tree-"));
    writeIntent(root, "api/pagination", "api/pagination");
    writeIntent(root, "api/pagination/cursor-only", "api/pagination/cursor-only");
    const load = loadIntentTree(root);
    expect(load.failures).toEqual([]);
    expect([...load.intents.keys()].sort()).toEqual(["api/pagination", "api/pagination/cursor-only"]);
  });

  test("a path-to-id mismatch is reported as a failure", () => {
    const root = mkdtempSync(join(tmpdir(), "dusk-tree2-"));
    writeIntent(root, "api/pagination", "api/wrong-id");
    const load = loadIntentTree(root);
    expect(load.failures.length).toBe(1);
  });

  test("a missing intents directory yields an empty tree, not an error", () => {
    const load = loadIntentTree(join(tmpdir(), "dusk-does-not-exist-xyz"));
    expect(load.intents.size).toBe(0);
  });
});
