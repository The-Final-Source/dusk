import { createTempRepo, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadProjectContext, scanDecorations } from "./context.js";

// universal-decoration-coverage §1 — KEYSTONE (board M4: red-first).
// The directory `.intent` sidecar is parsed only by the gate today; the three
// index-building walkers are `.ts`-only and never read it, so `.intent` records
// never reach `buildDerivedIndex` and are invisible to the Verifier / reverse
// index / doctor. These tests prove the gap closes through the shared scanner.

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
});
afterEach(() => {
  repo.cleanup();
});

describe("keystone — a directory `.intent` claim reaches the derived index", () => {
  test("loadProjectContext surfaces a directory `.intent` claim via reverse(file)", () => {
    repo.write("src/.intent", "@intent api/foo\n");
    repo.write("src/handler.ts", "// @intent api/foo\nexport const handler = () => 1;\n");

    const ctx = loadProjectContext(repo.dir);

    // The `.intent` claim must be visible through the derived index, not only the gate.
    expect(ctx.index.reverse("src/.intent")).toContain("api/foo");
    expect(ctx.index.forward("api/foo").some((r) => r.file === "src/.intent")).toBe(true);
  });

  test("the shared scanner returns directory `.intent` records", () => {
    repo.write("pkg/.intent", "@intent api/bar [t1]\n");
    const records = scanDecorations(repo.dir);
    const dot = records.find((r) => r.file === "pkg/.intent");
    expect(dot).toBeDefined();
    expect(dot?.intent_path).toBe("api/bar");
    expect(dot?.scope).toBe("directory");
  });
});
