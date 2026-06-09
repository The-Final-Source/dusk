import { describe, test, expect } from "vitest";

import { parseDotIntent } from "./parseDotIntent.js";

describe("parseDotIntent (P1-T16)", () => {
  test("records directory-scope claims, ignoring comments and blanks", () => {
    const source = `# package invariants\n@intent web/no-api-runtime-imports\n\n@intent web/route-naming [filename-pattern, export-shape]\n`;
    const { records, errors } = parseDotIntent(source, "packages/web/.intent");
    expect(errors).toEqual([]);
    expect(records.map((r) => r.intent_path)).toEqual(["web/no-api-runtime-imports", "web/route-naming"]);
    expect(records.every((r) => r.scope === "directory")).toBe(true);
    expect(records[1].aspect_ids).toEqual(["filename-pattern", "export-shape"]);
  });

  test("rejects more than one claim on a single line", () => {
    const { errors } = parseDotIntent("@intent web/a @intent web/b\n", ".intent");
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("one claim per line");
  });
});
