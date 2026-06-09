import { describe, test, expect } from "vitest";

import { migrateRawIntent } from "./migration.js";
import { parseIntent } from "./load.js";

// P1-T1 — older intent corpora migrate forward without authoring intervention.
describe("forward migration (P1-T1)", () => {
  test("negated → polarity, flat relates_to → sibling, refines → parent, with a deprecation warning each", () => {
    const raw = {
      schema_version: 1,
      id: "api/pagination",
      description: "d",
      obligation: "must",
      triples: [{ id: "t", subject: "list endpoints", predicate: "use", object: "offset pagination", negated: true }],
      relates_to: ["api/list", { kind: "refines", target: "api/pagination/base" }],
    };

    const { value, warnings } = migrateRawIntent(raw);

    const triples = value.triples as Array<Record<string, unknown>>;
    expect(triples[0]).toMatchObject({ polarity: "negative" });
    expect(triples[0]).not.toHaveProperty("negated");
    expect(value.relates_to).toEqual([
      { kind: "sibling", target: "api/list" },
      { kind: "parent", target: "api/pagination/base" },
    ]);
    expect(value.schema_version).toBe(2);
    expect(warnings.some((w) => w.includes("negated"))).toBe(true);
    expect(warnings.some((w) => w.includes("sibling"))).toBe(true);
    expect(warnings.some((w) => w.includes("refines"))).toBe(true);
  });

  test("a migrated legacy intent loads cleanly through parseIntent", () => {
    const raw = {
      schema_version: 1,
      id: "api/pagination",
      description: "d",
      obligation: "must",
      triples: [{ id: "t", subject: "s", predicate: "p", object: "o", negated: true }],
      relates_to: ["api/list"],
    };
    const load = parseIntent(raw);
    expect(load.success).toBe(true);
    if (load.success) {
      expect(load.intent.triples?.[0]?.polarity).toBe("negative");
      expect(load.intent.relates_to).toEqual([{ kind: "sibling", target: "api/list" }]);
      expect(load.warnings.length).toBeGreaterThanOrEqual(2);
    }
  });
});
