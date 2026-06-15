import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { loadProjectContext } from "@dusk/mcp-server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { gateWorktreeEdits } from "./implement.js";
import { runStaticAnalysis } from "./doctorStaticAnalysis.js";

// universal-decoration-coverage §8 — one end-to-end fixture composing §1–§7:
// an inline comment-bearing file, a package.json + sidecar (full coverage), and
// ignored node_modules + .env. Asserts the index sees every decoration source,
// the gate passes when covered and blocks on an introduced gap, the doctor is
// clean, and structural records are skipped by the semantic path.

let dir: string;
const write = (rel: string, content: string): void => {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
};
const intentYaml = (id: string): string =>
  `schema_version: 2\nid: ${id}\ndescription: ${id}\nobligation: must\ncompose: all\ntriples:\n  - id: t\n    subject: s\n    predicate: p\n    object: o\n`;

const fullSidecar = JSON.stringify({ schema_version: 1, target: "package.json", claims: [{ anchor: "", marker: "intent-file", intent_path: "pkg/manifest" }] });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dusk-udc-e2e-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  write("dusk.config.yml", "version: 1\n");
  write(".ia/intents/api/handler/intent.yaml", intentYaml("api/handler"));
  write(".ia/intents/pkg/manifest/intent.yaml", intentYaml("pkg/manifest"));
  // comment-bearing file, decorated inline
  write("src/handler.ts", "// @intent api/handler\nexport const handler = () => 1;\n");
  // comment-less file, covered by a whole-file sidecar
  write("package.json", '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n');
  write("package.json.intent", fullSidecar);
  // ignored by the decoration.ignore SSoT defaults — would be a violation if scanned
  write("node_modules/dep/index.ts", "export const x = 1;\n");
  write(".env", "SECRET=shh\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("universal-decoration-coverage — end-to-end", () => {
  test("the index sees inline AND sidecar sources; ignored files are absent", () => {
    const ctx = loadProjectContext(dir);
    expect(ctx.index.reverse("src/handler.ts")).toContain("api/handler"); // inline
    expect(ctx.index.reverse("package.json")).toContain("pkg/manifest"); // sidecar (keystone)
    // node_modules / .env never entered the scan.
    expect(ctx.index.records.some((r) => r.file.startsWith("node_modules"))).toBe(false);
    expect(ctx.index.records.some((r) => r.file === ".env")).toBe(false);
  });

  test("the sidecar record is structural and skipped by the semantic path, but visible to reverse()", () => {
    const ctx = loadProjectContext(dir);
    const structural = ctx.index.records.find((r) => r.file === "package.json");
    expect(structural?.verify).toBe("structural");
    // excluded from the semantic record set + focalSupport...
    expect(ctx.index.semanticRecords.some((r) => r.file === "package.json")).toBe(false);
    expect(ctx.index.focalSupport("pkg/manifest", "t").focal).toHaveLength(0);
    // ...but still visible to the reverse-index / inspect (keystone preserved).
    expect(ctx.index.reverse("package.json")).toContain("pkg/manifest");
  });

  test("the gate passes when fully covered, blocks on an introduced gap (at the target line)", () => {
    expect(gateWorktreeEdits(dir)).toEqual({ blocked: false });

    // Introduce a gap: claim only /name, leaving "version" (line 3) uncovered.
    write("package.json.intent", JSON.stringify({ schema_version: 1, target: "package.json", claims: [{ anchor: "/name", marker: "intent", intent_path: "pkg/manifest" }] }));
    const blocked = gateWorktreeEdits(dir);
    expect(blocked.blocked).toBe(true);
    expect(blocked.rejection).toContain("uncovered_target_lines");
    expect(blocked.rejection).toContain("package.json:3");
  });

  test("the doctor is clean on the fully-covered project", () => {
    const result = runStaticAnalysis(dir, { now: () => 1_750_000_000_000 });
    expect(result.report!.findings.some((f) => f.class === "uncovered_target_lines" || f.class === "unresolved_anchor")).toBe(false);
  });
});
