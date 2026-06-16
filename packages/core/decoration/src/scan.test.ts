import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { scanDecorations } from "./scan.js";

// universal-decoration-coverage §1 — the shared `.intent`-aware scanner.

let root: string;
const write = (rel: string, content: string): void => {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dusk-scan-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scanDecorations — one walk, three parsers, one ignore SSoT", () => {
  test("dispatches inline, directory `.intent`, and per-file sidecar", () => {
    write("src/handler.ts", "// @intent api/handler\nexport const handler = () => 1;\n");
    write("src/.intent", "@intent api/module\n");
    write("package.json", '{\n  "name": "pkg",\n  "version": "1.0.0"\n}\n');
    write("package.json.intent", JSON.stringify({ schema_version: 1, target: "package.json", claims: [{ anchor: "", marker: "intent-file", intent_path: "pkg/manifest" }] }));

    const records = scanDecorations(root);

    const inline = records.find((r) => r.file === "src/handler.ts");
    expect(inline).toMatchObject({ intent_path: "api/handler", verify: "semantic", anchor: null });

    const dot = records.find((r) => r.file === "src/.intent");
    expect(dot).toMatchObject({ intent_path: "api/module", scope: "directory" });

    const sidecar = records.find((r) => r.file === "package.json" && r.verify === "structural");
    expect(sidecar).toMatchObject({ intent_path: "pkg/manifest", scope: "file", marker: "intent-file", anchor: "" });
  });

  test("honors the ignore globs (no shadow skip list)", () => {
    write("node_modules/dep/index.ts", "// @intent vendor/dep\nexport const x = 1;\n");
    write("custom/skip.ts", "// @intent custom/thing\nexport const y = 1;\n");
    write("src/keep.ts", "// @intent api/keep\nexport const z = 1;\n");

    const records = scanDecorations(root, { ignore: ["node_modules/**", "custom/**"] });
    const files = records.map((r) => r.file);
    expect(files).toContain("src/keep.ts");
    expect(files.some((f) => f.startsWith("node_modules"))).toBe(false);
    expect(files.some((f) => f.startsWith("custom"))).toBe(false);
  });

  test("a sidecar whose target is absent emits no records (reported by gate/doctor, not the scanner)", () => {
    write("orphan.json.intent", JSON.stringify({ schema_version: 1, target: "orphan.json", claims: [{ anchor: "", marker: "intent-file", intent_path: "x/y" }] }));
    const records = scanDecorations(root);
    expect(records).toHaveLength(0);
  });
});
