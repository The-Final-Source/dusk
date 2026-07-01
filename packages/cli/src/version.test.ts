import { describe, expect, test } from "vitest";

import { formatVersion, type BuildInfo } from "./version.js";

const info = (over: Partial<BuildInfo> = {}): BuildInfo => ({
  sha: "aaaaaaaaaaaaaaaa1111",
  branch: "feat/x",
  dirty: false,
  builtAt: "2026-06-22T00:00:00.000Z",
  ...over,
});

describe("formatVersion — build provenance + staleness", () => {
  test("HEAD matches the build sha → ✓ matches", () => {
    const out = formatVersion(info(), "aaaaaaaaaaaaaaaa1111");
    expect(out).toContain("built from: aaaaaaaaaa (feat/x)");
    expect(out).toContain("✓ matches current repo HEAD");
    expect(out).not.toContain("STALE");
  });

  test("HEAD moved past the build sha → ⚠ STALE with a rebuild hint", () => {
    const out = formatVersion(info(), "bbbbbbbbbbbbbbbb2222");
    expect(out).toContain("⚠ STALE");
    expect(out).toContain("repo HEAD is now bbbbbbbbbb");
    expect(out).toContain("pnpm --filter @dusk/cli build");
  });

  test("a dirty build is flagged even when it matches HEAD (not pinned to a commit)", () => {
    const out = formatVersion(info({ dirty: true }), "aaaaaaaaaaaaaaaa1111");
    expect(out).toContain("+dirty");
    expect(out).toContain("built dirty");
  });

  test("no live HEAD (git unavailable) → cannot compare, never a false ✓", () => {
    const out = formatVersion(info(), null);
    expect(out).toContain("cannot compare to repo HEAD");
    expect(out).not.toContain("✓ matches");
    expect(out).not.toContain("STALE");
  });
});
