import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";

import { createTempRepo, type TempRepo } from "@dusk/test-harness";

import { loadProject, type ProjectContext } from "./loadProject.js";
import { runChecks } from "./checks.js";
import type { RejectionKind } from "./rejections.js";

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

describe("supersedes gate-warn (P1-T21)", () => {
  test("a write referencing a superseded intent warns without blocking", () => {
    const content = `// @intent api/old [o]\nexport function f() {}\n`;
    const result = runChecks(content, FILE(), ctx);
    expect(result.rejections).toEqual([]);
    expect(result.warnings.map((w) => w.kind)).toContain("superseded_intent_reference");
  });
});
