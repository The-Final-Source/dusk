import { describe, expect, test } from "vitest";

import { createIgnoreMatcher, DEFAULT_DECORATION_IGNORE, loadIgnoreGlobs } from "./ignore.js";

// universal-decoration-coverage §4 — the `decoration.ignore` glob SSoT.

describe("createIgnoreMatcher", () => {
  const isIgnored = createIgnoreMatcher(DEFAULT_DECORATION_IGNORE);

  test("prunes dependency + generated dirs and their contents", () => {
    expect(isIgnored("node_modules")).toBe(true);
    expect(isIgnored("node_modules/foo/index.js")).toBe(true);
    expect(isIgnored("dist")).toBe(true);
    expect(isIgnored("dist/bundle.js")).toBe(true);
    expect(isIgnored(".ia/runtime")).toBe(true);
    expect(isIgnored(".ia/runtime/state.db")).toBe(true);
  });

  test("does NOT prune `.ia/intents` (only `.ia/runtime` is generated)", () => {
    expect(isIgnored(".ia")).toBe(false);
    expect(isIgnored(".ia/intents/api/foo/intent.yaml")).toBe(false);
  });

  test("matches `**/*.lock` at any depth and `.env*` by basename", () => {
    expect(isIgnored("pnpm.lock")).toBe(true);
    expect(isIgnored("a/b/c.lock")).toBe(true);
    expect(isIgnored(".env")).toBe(true);
    expect(isIgnored(".env.local")).toBe(true);
    expect(isIgnored("src/handler.ts")).toBe(false);
    expect(isIgnored("package.json")).toBe(false);
  });

  test("honors project additions merged via loadIgnoreGlobs", () => {
    const globs = loadIgnoreGlobs({ decoration: { ignore: ["generated/**", "*.snap"] } });
    const m = createIgnoreMatcher(globs);
    expect(globs).toContain("node_modules/**"); // defaults preserved
    expect(m("generated/schema.json")).toBe(true);
    expect(m("x/y/foo.snap")).toBe(true);
    expect(m("src/handler.ts")).toBe(false);
  });
});
