import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";
import type { Intent, RelatesTo } from "@dusk/core-schema";
import { createTempRepo, fixedClock, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { decompose } from "./decompose.js";

// §5 bead-decomposition — zero-model + fixture intents.

const clock = fixedClock(Date.parse("2026-06-10T00:00:00.000Z"));

const mkIntent = (id: string, relates_to: RelatesTo[] = []): Intent => ({
  schema_version: 2,
  id,
  description: `intent ${id}`,
  obligation: "must",
  compose: "all",
  triples: [{ id: "t1", subject: "s", predicate: "p", object: "o", polarity: "positive" }],
  relates_to,
});

const mkIndex = (intents: Intent[], records: DecorationRecord[] = []): DerivedIndex =>
  buildDerivedIndex(records, new Map(intents.map((i) => [i.id, i])));

const focal = (file: string, line: number, intentPath: string, declaration_name: string | null): DecorationRecord => ({
  file,
  line,
  scope: declaration_name ? "declaration" : "statement",
  declaration_name,
  marker: "intent",
  intent_path: intentPath,
  aspect_ids: ["t1"],
  support_triple: null,
  ignore_clause: null,
});

const support = (file: string, line: number, intentPath: string): DecorationRecord => ({
  file,
  line,
  scope: "statement",
  declaration_name: null,
  marker: "intent-support",
  intent_path: intentPath,
  aspect_ids: ["t1"],
  support_triple: ["s", "p", "o"],
  ignore_clause: null,
});

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
});
afterEach(() => repo.cleanup());

const run = (index: DerivedIndex, scopeHint: string[]) =>
  decompose({ index, clock, rootDir: repo.dir, request: "do the thing", scopeHint });

describe("5.1 — typed relates_to walking (P3-T2, all six scenarios)", () => {
  test("implies auto-adds the target with an edge from X's bead to Y's bead", () => {
    const index = mkIndex([mkIntent("api/x", [{ kind: "implies", target: "api/y" }]), mkIntent("api/y")]);
    const r = run(index, ["api/x"]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.activeIntents).toContain("api/y");
    const edge = r.value.dag.edges.find((e) => e.kind === "implies");
    expect(edge).toBeDefined();
    expect(edge!.from).toBe(r.value.beadForIntent["api/x"]);
    expect(edge!.to).toBe(r.value.beadForIntent["api/y"]);
  });

  test("conflicts causes a hard refusal with no DAG issued", () => {
    const index = mkIndex([mkIntent("api/x", [{ kind: "conflicts", target: "api/z" }]), mkIntent("api/z")]);
    const r = run(index, ["api/x", "api/z"]);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.kind).toBe("decomposer_bead_conflict");
  });

  test("supersedes excludes the superseded target", () => {
    const index = mkIndex([mkIntent("api/x", [{ kind: "supersedes", target: "api/w" }]), mkIntent("api/w")]);
    const r = run(index, ["api/x", "api/w"]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.activeIntents).not.toContain("api/w");
    expect(r.value.beadForIntent["api/w"]).toBeUndefined();
  });

  test("sibling is context-only — target absent, no bead, no edge (the negative)", () => {
    const index = mkIndex([mkIntent("api/x", [{ kind: "sibling", target: "api/s" }]), mkIntent("api/s")]);
    const r = run(index, ["api/x"]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.activeIntents).not.toContain("api/s"); // S ∉ active_set
    expect(r.value.beadForIntent["api/s"]).toBeUndefined(); // no bead for S
    expect(r.value.dag.edges.every((e) => e.kind !== "sibling")).toBe(true); // no scope-expansion edge
  });

  test("path parent pulls the ancestor into scope with a descendant→ancestor edge", () => {
    const index = mkIndex([mkIntent("a/b"), mkIntent("a/b/c")]);
    const r = run(index, ["a/b/c"]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.activeIntents).toContain("a/b");
    const edge = r.value.dag.edges.find((e) => e.kind === "parent");
    expect(edge!.from).toBe(r.value.beadForIntent["a/b/c"]);
    expect(edge!.to).toBe(r.value.beadForIntent["a/b"]);
  });

  test("test-pyramid children are auto-added with a dependency on the parent's bead", () => {
    const index = mkIndex([mkIntent("api/x"), mkIntent("api/x/unit-tests")]);
    const r = run(index, ["api/x"]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.activeIntents).toContain("api/x/unit-tests");
    const edge = r.value.dag.edges.find((e) => e.kind === "test-pyramid");
    expect(edge!.from).toBe(r.value.beadForIntent["api/x/unit-tests"]);
    expect(edge!.to).toBe(r.value.beadForIntent["api/x"]);
  });
});

describe("5.2 — bead DAG: file-overlap + claim-overlap precondition (P3-T3/T4)", () => {
  test("file-overlap serializes would-be parallel writers", () => {
    const index = mkIndex(
      [mkIntent("observability/log"), mkIntent("api/handler")],
      [focal("src/handler.ts", 3, "observability/log", "logEntry"), focal("src/handler.ts", 20, "api/handler", "handle")],
    );
    const r = run(index, ["observability/log", "api/handler"]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    const edge = r.value.dag.edges.find((e) => e.source === "file-overlap");
    expect(edge).toBeDefined();
  });

  test("focal-claim overlap on the same region is a hard refusal", () => {
    const index = mkIndex(
      [mkIntent("api/a"), mkIntent("api/b")],
      [focal("src/shared.ts", 10, "api/a", "shared"), focal("src/shared.ts", 10, "api/b", "shared")],
    );
    const r = run(index, ["api/a", "api/b"]);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.kind).toBe("decomposer_bead_conflict");
  });

  test("support-claim overlap is an advisory warning, not a refusal", () => {
    const index = mkIndex(
      [mkIntent("api/a"), mkIntent("api/b")],
      [
        focal("src/x.ts", 4, "api/a", "fa"),
        focal("src/x.ts", 30, "api/b", "fb"),
        support("src/x.ts", 50, "api/a"),
        support("src/x.ts", 50, "api/b"),
      ],
    );
    const r = run(index, ["api/a", "api/b"]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.warnings).toHaveLength(1);
    expect(r.value.warnings[0].kind).toBe("support_overlap");
    expect(r.value.warnings[0].file).toBe("src/x.ts");
  });
});

describe("5.3 — unresolved intent reference pauses with a disk checkpoint (P3-T5)", () => {
  test("an unauthored reference returns implement_paused_for_authoring + writes a checkpoint; no DAG", () => {
    const index = mkIndex([mkIntent("api/known")]);
    const r = decompose({ index, clock, rootDir: repo.dir, request: "add the new behavior", scopeHint: ["api/unauthored"] });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.kind).toBe("implement_paused_for_authoring");
    const token = r.error.details?.resume_token as string;
    expect(token).toMatch(/^rt_[0-9]{14}[0-9]{3}$/);
    expect(r.error.details?.unresolved_refs).toEqual(["api/unauthored"]);
    expect(r.error.details?.suggested_dialog_seed).toBe("api/unauthored");
    // Checkpoint exists carrying the original request.
    expect(repo.exists(`.ia/runtime/implement/${token}.json`)).toBe(true);
    const cp = JSON.parse(repo.read(`.ia/runtime/implement/${token}.json`));
    expect(cp.original_request).toBe("add the new behavior");
  });
});
