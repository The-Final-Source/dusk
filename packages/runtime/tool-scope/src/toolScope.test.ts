import { describe, expect, test } from "vitest";

import { resolveToolScope } from "./toolScope.js";

describe("resolveToolScope", () => {
  test("passes the declared tools through as an advisory scope", () => {
    const scope = resolveToolScope(["Read", "Grep"]);
    expect(scope.tools).toEqual(["Read", "Grep"]);
    expect(scope.advisory).toBe(true);
  });

  test("undefined tools resolves to an empty advisory scope", () => {
    expect(resolveToolScope(undefined)).toEqual({ tools: [], advisory: true });
  });
});
