import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DuskConfigSchema, IntentSchema, type Intent } from "@dusk/core-schema";
import { parseDecorations } from "@dusk/core-decoration";
import { buildDerivedIndex } from "@dusk/core-index";

import { ENGINEER_FILE_INSTRUCTION, chooseVerifierRoute, gateWorktreeEdits } from "./implement.js";

// D.32 / D1 — the verifier routes test intents to the Stage-1 pre-pass by the
// AUTHORED suffix, never by the decoration marker. These pin the route decision
// in isolation (zero-model): the genuine "assert on the route taken".
describe("chooseVerifierRoute — route by authored suffix, not the marker (D.32/D1)", () => {
  const config = DuskConfigSchema.parse({});
  const mkIntent = (id: string, triples: { id: string; verify?: "structural" | "semantic" }[]): Intent =>
    IntentSchema.parse({
      id,
      description: "d",
      obligation: "must",
      triples: triples.map((t) => ({ id: t.id, subject: "s", predicate: "p", object: "o", ...(t.verify ? { verify: t.verify } : {}) })),
    });

  test("a test-suffix intent whose ONLY claimant is @intent (empty testDiscovery) still routes to the pre-pass", () => {
    // The exact silent-accept scenario: the Engineer stamped the focal, non-test
    // `@intent` marker on a test file, so testDiscovery is empty. The OLD
    // marker-based router fell through to ordinary verification here; the NEW
    // suffix-based router sends it to the pre-pass regardless.
    const intentPath = "app/notifications/unit-tests";
    const records = parseDecorations(`// @intent ${intentPath} [a]\nexport const t = 1;\n`, "x.test.ts");
    const index = buildDerivedIndex(records, new Map([[intentPath, mkIntent(intentPath, [{ id: "a" }])]]));

    expect(index.testDiscovery(intentPath)).toHaveLength(0); // marker-based router would fall through (the bug)
    expect(chooseVerifierRoute(intentPath, index, config)).toBe("prepass"); // suffix-based router does not
  });

  test("a test-suffix intent correctly decorated with @intent-test-file also routes to the pre-pass", () => {
    const intentPath = "app/notifications/unit-tests";
    const records = parseDecorations(`// @intent-test-file ${intentPath}\nexport const t = 1;\n`, "x.test.ts");
    const index = buildDerivedIndex(records, new Map([[intentPath, mkIntent(intentPath, [{ id: "a" }])]]));

    expect(index.testDiscovery(intentPath)).toHaveLength(1);
    expect(chooseVerifierRoute(intentPath, index, config)).toBe("prepass");
  });

  test("a non-test intent routes by the structural/semantic channel (orthogonal axis, D6)", () => {
    const semantic = mkIntent("app/notifications/send", [{ id: "a" }]);
    const structural = mkIntent("app/notifications/cfg", [{ id: "a", verify: "structural" }]);
    const mixed = mkIntent("app/notifications/mix", [{ id: "a", verify: "structural" }, { id: "b" }]);
    const index = buildDerivedIndex([], new Map([[semantic.id, semantic], [structural.id, structural], [mixed.id, mixed]]));

    expect(chooseVerifierRoute("app/notifications/send", index, config)).toBe("semantic");
    expect(chooseVerifierRoute("app/notifications/cfg", index, config)).toBe("structural");
    expect(chooseVerifierRoute("app/notifications/mix", index, config)).toBe("mixed");
  });
});

describe("P6 — the engineer is taught to cover comment-less files with sidecars (udc/D.28)", () => {
  test("ENGINEER_FILE_INSTRUCTION teaches the <file>.intent sidecar for comment-less files", () => {
    // Without this, the engineer writes package.json with no sidecar and the
    // post-hoc gate's coverage tiling hard-blocks it (uncovered comment-less
    // target), thrashing the greenfield build.
    expect(ENGINEER_FILE_INSTRUCTION).toContain(".intent");
    expect(ENGINEER_FILE_INSTRUCTION.toLowerCase()).toContain("sidecar");
    expect(ENGINEER_FILE_INSTRUCTION).toContain("package.json");
    expect(ENGINEER_FILE_INSTRUCTION).toContain("schema_version");
  });
});

// D.32 / design D5 — the Engineer is taught the test markers (liveness). A
// presence check: the instruction + a skill name the markers, with a worked
// example. (Mechanical guards, not this, guarantee correctness.)
describe("D.32 — the engineer is taught the test markers (D5)", () => {
  test("ENGINEER_FILE_INSTRUCTION names @intent-test/@intent-test-file and the never-@intent rule", () => {
    expect(ENGINEER_FILE_INSTRUCTION).toContain("@intent-test-file");
    expect(ENGINEER_FILE_INSTRUCTION).toContain("@intent-test");
    expect(ENGINEER_FILE_INSTRUCTION.toLowerCase()).toContain("test-pyramid");
    expect(ENGINEER_FILE_INSTRUCTION).toContain("non_test_marker_on_test_intent");
  });

  test("the dusk/engineer/test-file-decoration skill teaches the markers with a worked example", () => {
    const skill = readFileSync(fileURLToPath(new URL("../assets/skills/dusk/engineer/test-file-decoration.md", import.meta.url)), "utf8");
    expect(skill).toContain("@intent-test-file");
    expect(skill).toContain("@intent-test");
    expect(skill).toMatch(/##\s*Worked example/i); // ≥1 worked example
    expect(skill).toContain("```ts"); // an actual code example
  });
});

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

  test("an undecorated directory .intent write IS blocked (A5 — .intent is in the gated set, not just .ts)", () => {
    // Pre-fix, the porcelain filter scanned only .ts/.tsx, so a malformed .intent
    // the engineer wrote slipped past the post-hoc gate even though runGate gates it.
    // D.28 (D2): a file named exactly `.intent` is the directory-scope sidecar.
    writeFileSync(join(dir, "src/.intent"), "@intent api/does-not-exist [a]\n");
    const result = gateWorktreeEdits(dir);
    expect(result.blocked).toBe(true);
    expect(result.rejection).toContain("unresolved_intent_path");
    expect(result.rejection).toContain(".intent");
  });

  test("a .d.ts declaration write is NOT gated (generated, not decoratable)", () => {
    writeFileSync(join(dir, "src/types.d.ts"), "export declare const v: number;\n");
    expect(gateWorktreeEdits(dir)).toEqual({ blocked: false });
  });

  // D.28 §5.3 — post-hoc comment-less coverage tiling (pair-state).
  const intentX = "// @intent api/x [a]\n";
  const sidecarFor = (target: string, claims: unknown[], ignore: unknown[] = []): string =>
    JSON.stringify({ schema_version: 1, target, claims, ignore });

  test("a comment-less package.json with a full-coverage sidecar passes", () => {
    writeFileSync(join(dir, "src/keep.ts"), intentX);
    writeFileSync(join(dir, "package.json"), '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n');
    writeFileSync(join(dir, "package.json.intent"), sidecarFor("package.json", [{ anchor: "", marker: "intent-file", intent_path: "api/x" }]));
    expect(gateWorktreeEdits(dir)).toEqual({ blocked: false });
  });

  test("an uncovered non-trivial line hard-blocks, citing the TARGET file:line (board M4)", () => {
    writeFileSync(join(dir, "package.json"), '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n');
    // Only /name claimed → "version" (line 3) is uncovered.
    writeFileSync(join(dir, "package.json.intent"), sidecarFor("package.json", [{ anchor: "/name", marker: "intent", intent_path: "api/x" }]));
    const result = gateWorktreeEdits(dir);
    expect(result.blocked).toBe(true);
    expect(result.rejection).toContain("uncovered_target_lines");
    expect(result.rejection).toContain("package.json:3"); // the TARGET line, not the sidecar
    expect(result.rejection).not.toContain("package.json.intent:");
  });

  test("a comment-less target with NO sidecar is fully uncovered and blocks", () => {
    writeFileSync(join(dir, "tsconfig.json"), '{\n  "compilerOptions": {}\n}\n');
    const result = gateWorktreeEdits(dir);
    expect(result.blocked).toBe(true);
    expect(result.rejection).toContain("uncovered_target_lines");
    expect(result.rejection).toContain("tsconfig.json");
  });

  test("a dangling sidecar anchor blocks with unresolved_anchor", () => {
    writeFileSync(join(dir, "package.json"), '{\n  "name": "demo"\n}\n');
    writeFileSync(join(dir, "package.json.intent"), sidecarFor("package.json", [{ anchor: "/missing", marker: "intent", intent_path: "api/x" }]));
    const result = gateWorktreeEdits(dir);
    expect(result.blocked).toBe(true);
    expect(result.rejection).toContain("unresolved_anchor");
  });

  test("an ignored comment-less file (decoration.ignore glob) is not coverage-checked", () => {
    writeFileSync(join(dir, "dusk.config.yml"), "version: 1\ndecoration:\n  ignore:\n    - generated/**\n");
    mkdirSync(join(dir, "generated"), { recursive: true });
    writeFileSync(join(dir, "generated/schema.json"), '{\n  "x": 1\n}\n');
    writeFileSync(join(dir, "src/keep.ts"), intentX);
    expect(gateWorktreeEdits(dir)).toEqual({ blocked: false });
  });

  test("a built-in ignored file (node_modules) is not coverage-checked", () => {
    mkdirSync(join(dir, "node_modules/dep"), { recursive: true });
    writeFileSync(join(dir, "node_modules/dep/package.json"), '{\n  "name": "dep"\n}\n');
    writeFileSync(join(dir, "src/keep.ts"), intentX);
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
