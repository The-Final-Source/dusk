import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";
import { TestVerdictSchema, ok, type BoundSpawn, type DuskTestRunResult, type Intent, type SubAgentTrace, type Verdict } from "@dusk/core-schema";
import { makeDuskTestCapture, makeVitestJsonReportString } from "@dusk/test-harness";
import { describe, expect, test } from "vitest";

import { discoverByLayer } from "./discovery.js";
import { runTestRunner } from "./run.js";
import { assembleTestVerdict } from "./verdict.js";
import { buildVitestArgv, type VitestRunner } from "./vitest.js";

// §9 test-execution — zero-model (scripted double + scripted Vitest reporter).

const TEST_INTENT = "notifications/send/unit-tests";
const TEST_FILE = "/repo/notifications/send.unit.test.ts";

const testIntent = (id: string, triples: string[]): Intent => ({
  schema_version: 2,
  id,
  description: id,
  obligation: "must",
  compose: "all",
  triples: triples.map((t) => ({ id: t, subject: "the test", predicate: "verifies", object: "the behavior", polarity: "positive" })),
  relates_to: [],
});

const testRec = (file: string, line: number, intentPath: string, triples: string[]): DecorationRecord => ({
  file,
  line,
  scope: "declaration",
  declaration_name: "a test",
  marker: "intent-test",
  intent_path: intentPath,
  aspect_ids: triples,
  support_triple: null,
  ignore_clause: null,
});

const verdict = (decision: "accept" | "reject"): Verdict => ({ intent_path: TEST_INTENT, decision, per_triple: [], aggregate_rationale: decision });

function makeSpawn(verdicts: Verdict[]): BoundSpawn {
  let i = 0;
  let ctr = 0;
  return async (params) => {
    ctr += 1;
    const trace: SubAgentTrace = { schema_version: 1, trace_id: `tr_${ctr}`, role: params.role, invocation_site: params.invocationSite ?? "implement", model: "stub", prompt_tokens: 0, completion_tokens: 0, latency_ms: 0, cost_usd: 0 };
    if (params.role === "verifier") return ok({ trace, assembledPrompt: params.input, verdict: verdicts[i++] });
    return ok({ trace, assembledPrompt: params.input, output: "ok" });
  };
}

const indexWith = (records: DecorationRecord[], intents: Intent[]): DerivedIndex =>
  buildDerivedIndex(records, new Map(intents.map((i) => [i.id, i])));

const deps = (index: DerivedIndex, spawn: BoundSpawn, vitestRunner?: VitestRunner) => ({
  spawn,
  index,
  beadId: "bd_1",
  sessionId: "s1",
  testIntentPath: TEST_INTENT,
  prepassInput: () => "review this test body",
  cwd: "/repo",
  vitestRunner,
});

describe("9.1 — Verifier-rejected tests are excluded from the Vitest invocation (P3-T16)", () => {
  test("a trivially-passing test rejected pre-pass never reaches Vitest; bead re-enters Step 4", async () => {
    const index = indexWith([testRec(TEST_FILE, 5, TEST_INTENT, ["covers-persist-first"])], [testIntent(TEST_INTENT, ["covers-persist-first"])]);
    const calls: string[][] = [];
    const result = await runTestRunner(deps(index, makeSpawn([verdict("reject")]), (files) => {
      calls.push(files);
      return makeDuskTestCapture([]);
    }));
    expect(result.success).toBe(true);
    if (!result.success || result.value.kind !== "reenter_step4") return;
    expect(result.value.rejected).toHaveLength(1);
    expect(result.value.rejected[0]).toMatchObject({ test_intent_path: TEST_INTENT, triple_id: "covers-persist-first" });
    expect(result.value.invokedFiles).not.toContain(TEST_FILE); // excluded from the argv
    expect(calls).toHaveLength(0); // Vitest never invoked
  });
});

describe("D.32 — a routed test intent with no body fails loud, never a green Vitest no-op (design D3)", () => {
  const focalRec = (file: string, line: number, intentPath: string): DecorationRecord => ({
    file,
    line,
    scope: "declaration",
    declaration_name: "a test",
    // the focal, NON-test marker the Engineer wrongly stamped — testDiscovery ignores it
    marker: "intent",
    intent_path: intentPath,
    aspect_ids: null,
    support_triple: null,
    ignore_clause: null,
  });

  test("zero test-marker claims → re-enter Step 4 with the explicit missing-marker signal; Vitest never invoked", async () => {
    // The silent-accept residual: the only claimant is the focal `@intent`, so
    // testDiscovery is empty. Pre-fix this flowed to runVitest([]) → a green pass.
    const index = indexWith([focalRec(TEST_FILE, 5, TEST_INTENT)], [testIntent(TEST_INTENT, ["covers-persist-first"])]);
    const calls: string[][] = [];
    const result = await runTestRunner(deps(index, makeSpawn([]), (files) => {
      calls.push(files);
      return makeDuskTestCapture([]);
    }));

    expect(result.success).toBe(true);
    if (!result.success || result.value.kind !== "reenter_step4") throw new Error("expected reenter_step4");
    expect(result.value.rejected.length).toBeGreaterThan(0);
    expect(result.value.rejected[0]).toMatchObject({ test_intent_path: TEST_INTENT, triple_id: "covers-persist-first" });
    expect(result.value.rejected[0].rationale).toContain("test_intent_no_test_marker");
    expect(result.value.rejected[0].rationale).toContain("@intent-test-file");
    expect(calls).toHaveLength(0); // Vitest never invoked → no silent green pass
  });
});

describe("9.2 — verified tests run under Vitest and roll up to a TestVerdict (offline wiring)", () => {
  test("pre-pass accept → Vitest invoked on the file → satisfied TestVerdict", async () => {
    const index = indexWith([testRec(TEST_FILE, 5, TEST_INTENT, ["covers-persist-first"])], [testIntent(TEST_INTENT, ["covers-persist-first"])]);
    const calls: string[][] = [];
    const result = await runTestRunner(deps(index, makeSpawn([verdict("accept")]), (files) => {
      calls.push(files);
      return makeDuskTestCapture([{ file: TEST_FILE, title: "persists before publishing", status: "passed", duration: 3 }]);
    }));
    expect(result.success).toBe(true);
    if (!result.success || result.value.kind !== "verdict") return;
    expect(calls[0]).toEqual([TEST_FILE]); // runner invoked on the verified file
    expect(result.value.verdict.decision).toBe("pass");
    expect(result.value.verdict.per_triple.find((t) => t.triple_id === "covers-persist-first")?.verdict).toBe("pass");
  });

  // App. D.34 (gap #1 / R7): a Stage-2 content FAIL must re-enter Step 4 (re-draft
  // + block commit) via the `reenter_step4` outcome — NEVER a silent green.
  test("a Stage-2 failing run re-enters Step 4 (blocks commit), never a verdict pass", async () => {
    const index = indexWith([testRec(TEST_FILE, 5, TEST_INTENT, ["covers-persist-first"])], [testIntent(TEST_INTENT, ["covers-persist-first"])]);
    const result = await runTestRunner(
      deps(index, makeSpawn([verdict("accept")]), () =>
        makeDuskTestCapture([{ file: TEST_FILE, title: "persists before publishing", status: "failed", duration: 3 }]),
      ),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.kind).toBe("reenter_step4"); // NOT "verdict" — the silent green is closed
    if (result.value.kind !== "reenter_step4") return;
    expect(result.value.rejected.map((r) => r.triple_id)).toContain("covers-persist-first");
  });

  // App. D.34 (gaps #3/#8 / R6): a Stage-2 run that did NOT yield Dusk's own result
  // schema (reporter absent / garbage) is an infrastructure `no_verdict` — never a
  // content fail, never a silent green, never a crash.
  test("a Stage-2 run with no Dusk-schema output resolves to no_verdict (not a fail, not a green)", async () => {
    const index = indexWith([testRec(TEST_FILE, 5, TEST_INTENT, ["covers-persist-first"])], [testIntent(TEST_INTENT, ["covers-persist-first"])]);
    const result = await runTestRunner(
      deps(index, makeSpawn([verdict("accept")]), () => ({
        // raw vitest JSON — a tool's vocabulary, NOT Dusk's own schema
        stdout: makeVitestJsonReportString([{ file: TEST_FILE, title: "t", status: "passed", duration: 1 }]),
        exitCode: 0,
        timedOut: false,
      })),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.kind).toBe("no_verdict"); // no interpreter injected → the conservative fallback
  });
});

// App. D.34 / decision ① — the agentic bridge interprets schema-absent raw output.
// It may push ONLY toward `fail` or `no_verdict`, NEVER `pass` (the asymmetry).
describe("D.34 — agentic interpretation of schema-absent Stage-2 output", () => {
  const idx = () => indexWith([testRec(TEST_FILE, 5, TEST_INTENT, ["covers-persist-first"])], [testIntent(TEST_INTENT, ["covers-persist-first"])]);
  const rawCapture = (timedOut = false) => () => ({ stdout: "FAIL src/x.test.ts > thing\n  AssertionError: expected 1 to be 2", exitCode: 1, timedOut });

  test("interpreter reads a genuine fail from raw output → reenter_step4 (never a silent green)", async () => {
    const result = await runTestRunner({
      ...deps(idx(), makeSpawn([verdict("accept")]), rawCapture()),
      interpretTestOutput: async () => ({ kind: "fail", rationale: "AssertionError in 'thing'" }),
    });
    expect(result.success).toBe(true);
    if (!result.success || result.value.kind !== "reenter_step4") return;
    expect(result.value.rejected.map((r) => r.triple_id)).toContain("covers-persist-first");
    expect(result.value.rejected[0].rationale).toContain("agent-read raw output");
  });

  test("interpreter cannot determine a failure → no_verdict (never a fabricated fail, never a pass)", async () => {
    const result = await runTestRunner({
      ...deps(idx(), makeSpawn([verdict("accept")]), rawCapture()),
      interpretTestOutput: async () => ({ kind: "no_verdict", reason: "tool_infrastructure" }),
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.kind).toBe("no_verdict");
  });

  test("a timed-out run is no_verdict WITHOUT invoking the agent (Dusk's own timeout is definitively infra)", async () => {
    let called = false;
    const result = await runTestRunner({
      ...deps(idx(), makeSpawn([verdict("accept")]), rawCapture(true)),
      interpretTestOutput: async () => {
        called = true;
        return { kind: "fail", rationale: "should not be reached" };
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.kind).toBe("no_verdict");
    expect(called).toBe(false); // the agent is never asked to interpret a timed-out (killed) run
  });
});

describe("9.3 — TestVerdict shape is frozen per App. A.5", () => {
  test("assembled TestVerdict parses against the schema", () => {
    const result: DuskTestRunResult = {
      schema_version: 1,
      passed: 1,
      failed: 0,
      not_run: 0,
      completed: true,
      cases: [{ name: "t", outcome: "passed", duration_ms: 2 }],
    };
    const v = assembleTestVerdict({
      testIntentPath: TEST_INTENT,
      coveredTriples: ["covers-persist-first", "covers-publish-sync"],
      result,
      outcome: "pass",
    });
    expect(TestVerdictSchema.safeParse(v).success).toBe(true);
    expect(v.decision).toBe("pass");
  });
});

describe("9.4 — configurable test-pyramid suffix discovery", () => {
  test("custom contract-tests suffix is discovered and routed to Vitest", () => {
    const contractIntent = "api/x/contract-tests";
    const file = "/repo/api/x.contract.test.ts";
    const index = indexWith(
      [testRec(file, 1, contractIntent, ["covers-contract"])],
      [testIntent("api/x", ["impl"]), testIntent(contractIntent, ["covers-contract"])],
    );
    const byLayer = discoverByLayer(index, "api/x", ["contract-tests"]);
    expect(byLayer["contract-tests"]).toHaveLength(1);
    expect(byLayer["contract-tests"][0].file).toBe(file);
    expect(buildVitestArgv([file])).toEqual(["vitest", "run", file, "--reporter=json"]);
  });
});

// Phase-5 dogfood regression: an `@intent-test-file` claim carries
// `aspect_ids: null` (= ALL aspects). Its pre-pass rejection must surface as
// reenter_step4 covering every triple of the test intent — never vanish into
// an empty cover set.
describe("file-scope test claims cover all aspects (P5 regression)", () => {
  test("a rejected @intent-test-file claim re-enters Step 4 naming every covered triple", async () => {
    const fileRec: DecorationRecord = {
      file: TEST_FILE,
      line: 1,
      scope: "file",
      declaration_name: null,
      marker: "intent-test-file",
      intent_path: TEST_INTENT,
      aspect_ids: null,
      support_triple: null,
      ignore_clause: null,
    };
    const index = buildDerivedIndex([fileRec], new Map([[TEST_INTENT, testIntent(TEST_INTENT, ["covers-a", "covers-b"])]]));
    const result = await runTestRunner({
      spawn: makeSpawn([verdict("reject")]),
      index,
      beadId: "bd_x",
      sessionId: "s",
      testIntentPath: TEST_INTENT,
      prepassInput: (claim) => `judge ${claim.file}`,
      cwd: "/repo",
      vitestRunner: () => {
        throw new Error("the Test Runner must never run a pre-pass-rejected file");
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.kind).toBe("reenter_step4");
    if (result.value.kind !== "reenter_step4") return;
    expect(result.value.rejected.map((r) => r.triple_id).sort()).toEqual(["covers-a", "covers-b"]);
    expect(result.value.invokedFiles).toEqual([]);
  });
});
