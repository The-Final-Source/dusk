import { describe, expect, test } from "vitest";

import { resolveDecorationConflict, type ConflictSide } from "./resolver.js";

// §11.4 — decorator-aware Conflict Resolver (P3-T20).

const side = (label: "a" | "b", intentPath: string, aspectIds: string[], body = "x"): ConflictSide => ({ label, intentPath, aspectIds, body });

describe("Conflict Resolver prefers more-specific decoration", () => {
  test("more aspect ids wins", () => {
    const r = resolveDecorationConflict(
      side("a", "api/pagination", ["cursor-decode"]),
      side("b", "api/pagination", ["cursor-decode", "cursor-encode"]),
    );
    expect(r.kind).toBe("prefer");
    if (r.kind !== "prefer") return;
    expect(r.chosen.label).toBe("b"); // two aspect ids
  });

  test("on equal aspect count, the more granular (deeper) intent path wins", () => {
    const r = resolveDecorationConflict(side("a", "api/pagination", ["x"]), side("b", "api/pagination/cursor-only", ["x"]));
    expect(r.kind).toBe("prefer");
    if (r.kind !== "prefer") return;
    expect(r.chosen.label).toBe("b");
  });

  test("equal specificity → TODO marker (rebase left for human review)", () => {
    const r = resolveDecorationConflict(side("a", "api/pagination", ["x"], "bodyA"), side("b", "api/pagination", ["x"], "bodyB"), "lines 10-14");
    expect(r.kind).toBe("tie");
    if (r.kind !== "tie") return;
    expect(r.todo).toContain("TODO(dusk-conflict)");
    expect(r.todo).toContain("lines 10-14");
    expect(r.todo).toContain("equal-specificity");
  });
});
