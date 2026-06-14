import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gateWorktreeEdits } from "./implement.js";

// The headless engineer's enforcement boundary (gateWorktreeEdits) is the
// system's PRIMARY code-writing gate, yet it had ZERO direct coverage — only a
// one-off manual run. A refactor of the porcelain parse or the runGate call site
// could silently re-open the fail-open hole with nothing red. These tests pin it.

let dir: string;
const intentDir = (id: string) => join(dir, ".ia/intents", id);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dusk-impl-gate-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  writeFileSync(join(dir, "dusk.config.yml"), "version: 1\n");
  mkdirSync(intentDir("api/x"), { recursive: true });
  writeFileSync(
    join(intentDir("api/x"), "intent.yaml"),
    "id: api/x\ndescription: d\nobligation: must\ntriples:\n  - id: a\n    subject: s\n    predicate: p\n    object: o\n",
  );
  mkdirSync(join(dir, "src"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("gateWorktreeEdits — the headless engineer's post-hoc gate", () => {
  test("a decorated .ts write is NOT blocked", () => {
    writeFileSync(join(dir, "src/clean.ts"), "// @intent api/x [a]\nexport const v = 1;\n");
    expect(gateWorktreeEdits(dir)).toEqual({ blocked: false });
  });

  test("an undecorated .ts write IS blocked, citing file + line + kind", () => {
    writeFileSync(join(dir, "src/dirty.ts"), "export const v = 1;\n");
    const result = gateWorktreeEdits(dir);
    expect(result.blocked).toBe(true);
    expect(result.rejection).toContain("missing_decorator");
    expect(result.rejection).toContain("src/dirty.ts");
  });

  test("an undecorated .intent write IS blocked (A5 — .intent is in the gated set, not just .ts)", () => {
    // Pre-fix, the porcelain filter scanned only .ts/.tsx, so a malformed .intent
    // the engineer wrote slipped past the post-hoc gate even though runGate gates it.
    writeFileSync(join(dir, "src/scope.intent"), "@intent api/does-not-exist [a]\n");
    const result = gateWorktreeEdits(dir);
    expect(result.blocked).toBe(true);
    expect(result.rejection).toContain("unresolved_intent_path");
    expect(result.rejection).toContain("scope.intent");
  });

  test("a .d.ts declaration write is NOT gated (generated, not decoratable)", () => {
    writeFileSync(join(dir, "src/types.d.ts"), "export declare const v: number;\n");
    expect(gateWorktreeEdits(dir)).toEqual({ blocked: false });
  });

  test("quoting hardening — an undecorated file with a non-ASCII name is still gated (--porcelain -z, not slice+quote)", () => {
    // git quotes non-ASCII paths in plain --porcelain; slice(3).trim() would
    // mangle the quoted form → existsSync miss → silent fail-OPEN for that file.
    // -z emits the raw unquoted path, so the violation is still caught.
    writeFileSync(join(dir, "src/résumé.ts"), "export const v = 1;\n");
    const result = gateWorktreeEdits(dir);
    expect(result.blocked).toBe(true);
    expect(result.rejection).toContain("missing_decorator");
  });
});
