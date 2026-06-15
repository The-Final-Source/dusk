import { describe, expect, test } from "vitest";

import { computeSidecarCoverage, nonTrivialLines } from "./coverage.js";
import { parseFileIntentSidecar } from "./parseFileIntentSidecar.js";

// universal-decoration-coverage §5.3 / D4 — the explicit JSON/JSONC non-trivial
// predicate (board M5), pinned for a real package.json AND a JSONC fixture.

describe("nonTrivialLines — the D4 predicate", () => {
  test("pins the non-trivial set for a real package.json", () => {
    const pkg = [
      "{", //                              1  structural-only → trivial
      '  "name": "demo",', //              2  key+scalar → non-trivial
      '  "version": "1.0.0",', //          3  non-trivial
      '  "scripts": {', //                 4  key (opens container) → non-trivial
      '    "build": "tsc",', //            5  non-trivial (the line TS regex mis-handles)
      '    "test": "vitest"', //           6  non-trivial
      "  },", //                           7  structural-only → trivial
      '  "keywords": [', //                8  key → non-trivial
      '    "a",', //                       9  scalar → non-trivial
      '    "b"', //                       10  scalar → non-trivial
      "  ]", //                           11  structural-only → trivial
      "}", //                             12  structural-only → trivial
    ].join("\n");
    expect([...nonTrivialLines(pkg)].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 8, 9, 10]);
  });

  test("pins the non-trivial set for a JSONC fixture with // and /* */ comments", () => {
    const jsonc = [
      "{", //                              1  trivial
      "  // the compiler options", //      2  line comment → trivial
      '  "compilerOptions": {', //         3  non-trivial
      "    /* strict mode */", //          4  block comment → trivial
      '    "strict": true,', //            5  non-trivial
      '    "target": "ES2022"', //         6  non-trivial
      "  },", //                           7  trivial
      "}", //                              8  trivial (trailing comma above)
    ].join("\n");
    expect([...nonTrivialLines(jsonc)].sort((a, b) => a - b)).toEqual([3, 5, 6]);
  });
});

const sidecar = (target: string, claims: unknown[], ignore: unknown[] = []): string =>
  JSON.stringify({ schema_version: 1, target, claims, ignore });

describe("computeSidecarCoverage", () => {
  const pkg = ['{', '  "name": "demo",', '  "version": "1.0.0"', "}"].join("\n");

  test("a whole-file root claim covers every non-trivial line", () => {
    const parse = parseFileIntentSidecar(sidecar("package.json", [{ anchor: "", marker: "intent-file", intent_path: "pkg/manifest" }]), pkg, "package.json.intent", "package.json");
    const cov = computeSidecarCoverage(pkg, parse.claimSpans, parse.ignoreSpans);
    expect(cov.uncoveredLines).toEqual([]);
  });

  test("a per-key claim leaving a non-trivial line uncovered is reported at the target line", () => {
    const parse = parseFileIntentSidecar(sidecar("package.json", [{ anchor: "/name", marker: "intent", intent_path: "pkg/name" }]), pkg, "package.json.intent", "package.json");
    const cov = computeSidecarCoverage(pkg, parse.claimSpans, parse.ignoreSpans);
    expect(cov.uncoveredLines).toEqual([3]); // "version" is line 3, uncovered
  });

  test("an @intent-ignore region covers what no claim does", () => {
    const parse = parseFileIntentSidecar(
      sidecar(
        "package.json",
        [{ anchor: "/name", marker: "intent", intent_path: "pkg/name" }],
        [{ anchor: "/version", because: ["this-key", "is-exempt-due-to", "policy"], reason: "managed externally" }],
      ),
      pkg,
      "package.json.intent",
      "package.json",
    );
    const cov = computeSidecarCoverage(pkg, parse.claimSpans, parse.ignoreSpans);
    expect(cov.uncoveredLines).toEqual([]);
  });

  test("two overlapping region claims are flagged; the root claim is exempt", () => {
    const target = ['{', '  "scripts": {', '    "build": "tsc"', "  }", "}"].join("\n");
    const parse = parseFileIntentSidecar(
      sidecar("package.json", [
        { anchor: "/scripts", marker: "intent", intent_path: "build/all" },
        { anchor: "/scripts/build", marker: "intent", intent_path: "build/compile" },
      ]),
      target,
      "package.json.intent",
      "package.json",
    );
    const cov = computeSidecarCoverage(target, parse.claimSpans, parse.ignoreSpans);
    expect(cov.overlaps).toHaveLength(1);
  });
});
