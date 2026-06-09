import { describe, test, expect } from "vitest";

import { parseIntent } from "./load.js";

const valid = {
  id: "api/pagination",
  description: "d",
  obligation: "must",
  triples: [{ id: "t", subject: "s", predicate: "p", object: "o" }],
};

describe("parseIntent", () => {
  test("returns success for a valid intent", () => {
    expect(parseIntent(valid).success).toBe(true);
  });

  test("returns located errors for a malformed intent", () => {
    const result = parseIntent({ id: "api/x", obligation: "must" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path === "description")).toBe(true);
    }
  });

  test("path-to-id mismatch is rejected when expectedId is supplied", () => {
    const result = parseIntent(valid, { expectedId: "api/other" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.path).toBe("id");
    }
  });

  test("path-to-id match passes", () => {
    expect(parseIntent(valid, { expectedId: "api/pagination" }).success).toBe(true);
  });
});
