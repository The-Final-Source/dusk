import { describe, expect, test } from "vitest";

import { parseFileIntentSidecar } from "./parseFileIntentSidecar.js";

// universal-decoration-coverage §3 — the sidecar parser + JSON-Pointer resolver.
// Structural anchor STORED; line view DERIVED (design D3, board R1/S8).

const sidecar = (claims: unknown[], ignore: unknown[] = []): string =>
  JSON.stringify({ schema_version: 1, target: "package.json", claims, ignore });

describe("parseFileIntentSidecar — derived line spans", () => {
  test("a per-key pointer resolves to the key's current line span", () => {
    const target = ['{', '  "name": "pkg",', '  "scripts": {', '    "build": "tsc"', "  }", "}"].join("\n");
    const parse = parseFileIntentSidecar(
      sidecar([{ anchor: "/scripts/build", marker: "intent", intent_path: "build/compile" }]),
      target,
      "package.json.intent",
      "package.json",
    );
    expect(parse.findings).toEqual([]);
    expect(parse.records).toHaveLength(1);
    // `"build": "tsc"` is line 4.
    expect(parse.records[0]).toMatchObject({ file: "package.json", line: 4, scope: "region", anchor: "/scripts/build", verify: "structural", marker: "intent", intent_path: "build/compile" });
  });

  test("the pointer follows the key after a reformat — resolves to the ACTUAL new line, not line 1 (board S8)", () => {
    const reordered = [
      "{",
      '  "scripts": {',
      '    "lint": "eslint",',
      '    "test": "vitest",',
      '    "build": "tsc"',
      "  },",
      '  "name": "pkg"',
      "}",
    ].join("\n");
    const parse = parseFileIntentSidecar(
      sidecar([{ anchor: "/scripts/build", marker: "intent", intent_path: "build/compile" }]),
      reordered,
      "package.json.intent",
      "package.json",
    );
    expect(parse.findings).toEqual([]);
    // `"build": "tsc"` is now line 5 — the resolver must land on it, not line 1.
    expect(parse.records[0].line).toBe(5);
    expect(parse.records[0].anchor).toBe("/scripts/build");
  });

  test("a dangling pointer is a hard unresolved_anchor finding (renamed key)", () => {
    const target = ['{', '  "scripts": {', '    "compile": "tsc"', "  }", "}"].join("\n");
    const parse = parseFileIntentSidecar(
      sidecar([{ anchor: "/scripts/build", marker: "intent", intent_path: "build/compile" }]),
      target,
      "package.json.intent",
      "package.json",
    );
    expect(parse.records).toHaveLength(0);
    expect(parse.findings).toEqual([
      expect.objectContaining({ kind: "unresolved_anchor", sidecar: "package.json.intent", target: "package.json", anchor: "/scripts/build" }),
    ]);
  });

  test("the root pointer covers the whole document and is scope:file", () => {
    const target = ['{', '  "name": "pkg",', '  "version": "1.0.0"', "}"].join("\n");
    const parse = parseFileIntentSidecar(
      sidecar([{ anchor: "", marker: "intent-file", intent_path: "pkg/manifest" }]),
      target,
      "package.json.intent",
      "package.json",
    );
    expect(parse.findings).toEqual([]);
    expect(parse.records[0]).toMatchObject({ scope: "file", anchor: "", marker: "intent-file", line: 1 });
    expect(parse.claimSpans[0]).toMatchObject({ startLine: 1, endLine: 4 });
  });

  test("an array-index pointer resolves", () => {
    const target = ['{', '  "workspaces": [', '    "packages/a",', '    "packages/b"', "  ]", "}"].join("\n");
    const parse = parseFileIntentSidecar(
      sidecar([{ anchor: "/workspaces/1", marker: "intent", intent_path: "ws/b" }]),
      target,
      "package.json.intent",
      "package.json",
    );
    expect(parse.findings).toEqual([]);
    expect(parse.records[0].line).toBe(4); // "packages/b"
  });

  test("a malformed sidecar is a malformed_sidecar finding", () => {
    const parse = parseFileIntentSidecar("{ not json", "{}", "package.json.intent", "package.json");
    expect(parse.records).toHaveLength(0);
    expect(parse.findings[0].kind).toBe("malformed_sidecar");
  });

  test("a malformed target is a malformed_sidecar finding", () => {
    const parse = parseFileIntentSidecar(
      sidecar([{ anchor: "", marker: "intent-file", intent_path: "pkg/manifest" }]),
      "{ not json at all ",
      "package.json.intent",
      "package.json",
    );
    expect(parse.findings[0].kind).toBe("malformed_sidecar");
  });

  test("JSONC targets (comments + trailing commas) parse", () => {
    const target = ["{", "  // the build script", '  "build": "tsc",', "}"].join("\n");
    const parse = parseFileIntentSidecar(
      sidecar([{ anchor: "/build", marker: "intent", intent_path: "build/compile" }]),
      target,
      "tsconfig.json.intent",
      "tsconfig.json",
    );
    expect(parse.findings).toEqual([]);
    expect(parse.records[0].line).toBe(3);
  });
});
