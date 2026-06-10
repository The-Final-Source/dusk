import { buildDerivedIndex } from "@dusk/core-index";
import { IntentSchema, type Intent } from "@dusk/core-schema";
import { describe, expect, test } from "vitest";

import { enrichDialogSeed } from "./seed.js";

/**
 * 5.1 — `enrichDialogSeed(unresolvedRefs, snapshot)` (unit-only; pure transform
 * over a fixture snapshot). Business-vocabulary framing naming the parent,
 * siblings, and relates_to context (design D4's worked example).
 */

const mkIntent = (id: string, description: string, relates: Array<{ kind: "implies" | "sibling"; target: string }> = []): Intent =>
  IntentSchema.parse({
    id,
    description,
    obligation: "must",
    compose: "all",
    triples: [{ id: "t1", subject: "s", predicate: "p", object: "o" }],
    relates_to: relates,
  });

const snapshot = () =>
  buildDerivedIndex(
    [],
    new Map([
      ["api/pagination/cursor-only", mkIntent("api/pagination/cursor-only", "List pagination is cursor-based; cursors are opaque tokens.", [{ kind: "implies", target: "api/pagination/cursor-only/cursor-encode" }])],
      ["api/pagination/cursor-only/cursor-decode", mkIntent("api/pagination/cursor-only/cursor-decode", "Cursor decoding validates input and produces a typed state.")],
    ]),
  );

describe("5.1 — enrichDialogSeed (P4 design D4)", () => {
  test("a missing leaf's seed names the parent's domain and the sibling in business vocabulary", () => {
    const seed = enrichDialogSeed(["api/pagination/cursor-only/cursor-encode"], snapshot(), "add cursor encoding for paginated lists");
    expect(seed).toContain('"add cursor encoding for paginated lists"');
    expect(seed).toContain('"api/pagination/cursor-only/cursor-encode"');
    // Parent context in business vocabulary, not just the path.
    expect(seed).toContain("api/pagination/cursor-only");
    expect(seed).toContain("cursors are opaque tokens");
    // Sibling existence: covers cursor decode but not encoding.
    expect(seed).toContain("cursor decode");
    expect(seed).toContain("but not cursor encode");
    // relates_to context: the parent points at the missing leaf.
    expect(seed).toContain("implies");
    // It is a Stage-1 framing prompt, not a joined ref list.
    expect(seed).not.toBe("api/pagination/cursor-only/cursor-encode");
    expect(seed).toContain("describe the cursor encode behavior you want");
  });

  test("multiple unresolved refs produce a coherent multi-ref seed naming both", () => {
    const seed = enrichDialogSeed(
      ["api/pagination/cursor-only/cursor-encode", "api/ratelimit/token-bucket"],
      snapshot(),
      "add cursor encoding and rate limiting",
    );
    expect(seed).toContain('"api/pagination/cursor-only/cursor-encode"');
    expect(seed).toContain('"api/ratelimit/token-bucket"');
    // The greenfield ref is framed as a new subtree; both refs get a prompt.
    expect(seed).toContain("new intent subtree");
    expect(seed.split("\n\n")).toHaveLength(2);
  });

  test("deterministic: same inputs produce byte-identical output", () => {
    const a = enrichDialogSeed(["api/x", "api/y"], snapshot(), "r");
    const b = enrichDialogSeed(["api/y", "api/x"], snapshot(), "r");
    expect(a).toBe(b);
  });
});
