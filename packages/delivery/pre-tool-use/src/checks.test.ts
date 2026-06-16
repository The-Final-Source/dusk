import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";

import { createTempRepo, type TempRepo } from "@dusk/test-harness";

import { loadProject, type ProjectContext } from "./loadProject.js";
import { runChecks } from "./checks.js";
import { REJECTION_KINDS, type RejectionKind } from "./rejections.js";

let repo: TempRepo;
let ctx: ProjectContext;
const FILE = (): string => join(repo.dir, "src/foo.ts");

function intent(id: string, triples: string[], extra = ""): void {
  const body = triples.map((t) => `  - id: ${t}\n    subject: s\n    predicate: p\n    object: o\n`).join("");
  repo.write(`.ia/intents/${id}/intent.yaml`, `id: ${id}\ndescription: d\nobligation: must\ntriples:\n${body}${extra}`);
}

beforeAll(() => {
  repo = createTempRepo({ git: false });
  repo.write("dusk.config.yml", "version: 1\n");
  intent("api/x", ["a", "b"]);
  intent("api/x/unit-tests", ["covers"]);
  intent("api/old", ["o"]);
  intent("api/new", ["n"], "relates_to:\n  - kind: supersedes\n    target: api/old\n");
  ctx = loadProject(FILE())!;
});
afterAll(() => repo.cleanup());

const CASES: Array<[RejectionKind, string]> = [
  ["missing_decorator", `export function f() {\n  return 1;\n}\n`],
  ["missing_statement_decorator", `// @intent api/x [a]\nexport function f() {\n  const v = go();\n}\n`],
  ["unresolved_intent_path", `// @intent api/nope [a]\nexport function f() {}\n`],
  ["unresolved_aspect_id", `// @intent api/x [zzz]\nexport function f() {}\n`],
  ["multiple_intents_on_one_line", `// @intent api/x @intent api/new\nexport function f() {}\n`],
  ["missing_ignore_because", `// @intent-ignore api/x reason="x"\nexport function f() {}\n`],
  ["missing_ignore_reason", `// @intent-ignore api/x because=(t, is-generated-by, g)\nexport function f() {}\n`],
  ["invalid_ignore_predicate", `// @intent-ignore api/x because=(t, bogus-pred, g) reason="x"\nexport function f() {}\n`],
  ["missing_support_triple", `// @intent api/x [a]\nexport function f() {\n  // @intent-support api/x [a]\n  const v = go();\n}\n`],
  ["focal_and_support_for_same_intent", `// @intent api/x [a]\n// @intent-support api/x [a] ["s", "p", "o"]\nexport function f() {}\n`],
  ["non_test_path_on_intent_test", `// @intent-test api/x [a]\ntest("x", () => {});\n`],
  ["non_test_marker_on_test_intent", `// @intent api/x/unit-tests [covers]\nexport const v = 1;\n`],
];

describe("PreToolUse checks (P1-T10 — rejection surface)", () => {
  test.each(CASES)("emits %s", (kind, content) => {
    const { rejections } = runChecks(content, FILE(), ctx);
    expect(rejections.map((r) => r.kind)).toContain(kind);
  });

  test("a fully, correctly decorated write produces no rejections (P1-T9 baseline)", () => {
    const content = `// @intent api/x [a]\nexport function f() {\n  // @intent api/x [a]\n  const v = go();\n}\n`;
    expect(runChecks(content, FILE(), ctx).rejections).toEqual([]);
  });
});

// D.32 / design D4 — the reverse of Check 9, scoped exactly to the focal claim
// of the test-suffix intent itself.
describe("reverse of Check 9 — a focal non-test marker may not claim a test-suffix intent", () => {
  const kinds = (content: string): string[] => runChecks(content, FILE(), ctx).rejections.map((r) => r.kind);

  test("@intent claiming a test-suffix intent is rejected with a fix-it message", () => {
    const result = runChecks(`// @intent api/x/unit-tests [covers]\nexport const v = 1;\n`, FILE(), ctx);
    const rej = result.rejections.find((r) => r.kind === "non_test_marker_on_test_intent");
    expect(rej).toBeDefined();
    expect(rej!.message).toContain("api/x/unit-tests");
    expect(rej!.message).toContain("@intent-test-file");
  });

  test("@intent-file claiming a test-suffix intent is rejected too", () => {
    expect(kinds(`// @intent-file api/x/unit-tests\nexport const v = 1;\n`)).toContain("non_test_marker_on_test_intent");
  });

  test("@intent-support claiming a test-suffix intent is NOT rejected (support, not focal)", () => {
    const content = `// @intent api/x [a]\nexport function f() {\n  // @intent-support api/x/unit-tests [covers] ["s", "p", "o"]\n  const v = go();\n}\n`;
    expect(kinds(content)).not.toContain("non_test_marker_on_test_intent");
  });

  test("@intent claiming a NON-test intent (in any file) is NOT rejected", () => {
    expect(kinds(`// @intent api/x [a]\nexport const v = 1;\n`)).not.toContain("non_test_marker_on_test_intent");
  });

  test("the correct @intent-test-file on a test-suffix intent passes both directions of Check 9", () => {
    const ks = kinds(`// @intent-test-file api/x/unit-tests\ntest("x", () => {});\n`);
    expect(ks).not.toContain("non_test_marker_on_test_intent");
    expect(ks).not.toContain("non_test_path_on_intent_test");
  });
});

describe("check 10 — matrix-predicate negation in a support triple (P1-T11)", () => {
  test("a negated support predicate is rejected as malformed with a polarity hint", () => {
    const content = `// @intent api/x [a]\nexport function f() {\n  // @intent-support api/x [a] ["the call", "does not deliver", "the event"]\n  const v = go();\n}\n`;
    const negation = runChecks(content, FILE(), ctx).rejections.find((r) => r.kind === "malformed_support_triple");
    expect(negation).toBeDefined();
    expect(negation?.hint).toContain("polarity");
  });

  test("the affirmative form is accepted", () => {
    const content = `// @intent api/x [a]\nexport function f() {\n  // @intent-support api/x [a] ["the call", "delivers", "the event"]\n  const v = go();\n}\n`;
    expect(runChecks(content, FILE(), ctx).rejections).toEqual([]);
  });
});

// D.28 §5.2 — per-write single-file sidecar validity (no cross-file tiling).
describe("PreToolUse sidecar checks (D.28 — per-file `<stem>.intent`)", () => {
  const SIDECAR = (): string => join(repo.dir, "package.json.intent");
  const body = (target: string, claims: unknown[], ignore: unknown[] = []): string =>
    JSON.stringify({ schema_version: 1, target, claims, ignore });

  test("a valid sidecar produces no rejections", () => {
    const content = body("package.json", [{ anchor: "", marker: "intent-file", intent_path: "api/x" }]);
    expect(runChecks(content, SIDECAR(), ctx).rejections).toEqual([]);
  });

  test("non-JSON content → malformed_sidecar", () => {
    expect(runChecks("@intent api/x\n", SIDECAR(), ctx).rejections.map((r) => r.kind)).toContain("malformed_sidecar");
  });

  test("an unknown marker → malformed_sidecar (Zod shape)", () => {
    const content = body("package.json", [{ anchor: "", marker: "bogus", intent_path: "api/x" }]);
    expect(runChecks(content, SIDECAR(), ctx).rejections.map((r) => r.kind)).toContain("malformed_sidecar");
  });

  test("target field not matching the stem → sidecar_target_missing", () => {
    const content = body("other.json", [{ anchor: "", marker: "intent-file", intent_path: "api/x" }]);
    expect(runChecks(content, SIDECAR(), ctx).rejections.map((r) => r.kind)).toContain("sidecar_target_missing");
  });

  test("an unresolved intent path / aspect reuses the existing checks", () => {
    expect(runChecks(body("package.json", [{ anchor: "", marker: "intent-file", intent_path: "api/nope" }]), SIDECAR(), ctx).rejections.map((r) => r.kind)).toContain("unresolved_intent_path");
    expect(runChecks(body("package.json", [{ anchor: "", marker: "intent-file", intent_path: "api/x", aspect_ids: ["zzz"] }]), SIDECAR(), ctx).rejections.map((r) => r.kind)).toContain("unresolved_aspect_id");
  });

  test("an invalid ignore predicate → invalid_ignore_predicate", () => {
    const content = body("package.json", [{ anchor: "", marker: "intent-file", intent_path: "api/x" }], [{ anchor: "/x", because: ["t", "bogus-pred", "g"], reason: "x" }]);
    expect(runChecks(content, SIDECAR(), ctx).rejections.map((r) => r.kind)).toContain("invalid_ignore_predicate");
  });

  test("the directory `.intent` is still directory-scope (not a sidecar)", () => {
    const dotIntent = join(repo.dir, "src/.intent");
    expect(runChecks("@intent api/x\n", dotIntent, ctx).rejections).toEqual([]);
  });
});

// D.28 §5.1 + D.32 — the rejection surface grows by the 5 coverage kinds and the
// 1 test-pyramid-routing reverse-of-Check-9 kind.
describe("REJECTION_KINDS (D.28 + D.32 — 18 mechanical + fail-safe)", () => {
  const D28_KINDS = ["malformed_sidecar", "sidecar_target_missing", "unresolved_anchor", "overlapping_anchors", "uncovered_target_lines"] as const;

  test("has 19 entries (18 mechanical + hook_internal_error)", () => {
    expect(REJECTION_KINDS).toHaveLength(19);
  });

  test("includes all 5 D.28 coverage kinds, none colliding", () => {
    for (const kind of D28_KINDS) expect(REJECTION_KINDS).toContain(kind);
    expect(new Set(REJECTION_KINDS).size).toBe(REJECTION_KINDS.length);
  });

  test("includes the D.32 reverse-of-Check-9 kind", () => {
    expect(REJECTION_KINDS).toContain("non_test_marker_on_test_intent");
  });
});

describe("supersedes gate-warn (P1-T21)", () => {
  test("a write referencing a superseded intent warns without blocking", () => {
    const content = `// @intent api/old [o]\nexport function f() {}\n`;
    const result = runChecks(content, FILE(), ctx);
    expect(result.rejections).toEqual([]);
    expect(result.warnings.map((w) => w.kind)).toContain("superseded_intent_reference");
  });
});
