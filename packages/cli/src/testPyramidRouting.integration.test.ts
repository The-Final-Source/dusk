import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";

import { createTempRepo, type TempRepo } from "@dusk/test-harness";
import { isTestIntentPath, testPyramidSuffixes } from "@dusk/core-schema";
import { loadProjectContext } from "@dusk/mcp-server";
import { runGate } from "@dusk/pre-tool-use";
import { realTestPrepassVerdict } from "@dusk/runtime-benchmark";
import type { ModelClient } from "@dusk/runtime-verifier";

import { chooseVerifierRoute } from "./implement.js";

// D.32 end-to-end (zero-model): the silent-accept is structurally impossible and
// the suffix-based and marker-based consumers agree under the enforced invariant.
// Composes the gate (write-time), the verifier routing, the pre-pass fail-loud
// guard, and the index consumers over one real on-disk fixture.

const PARENT = "app/notifications/send";
const TEST_INTENT = "app/notifications/send/unit-tests";

// A model client that throws if ever called — proves the pre-pass guard
// pre-empts the model on an empty body (no silent accept).
const throwingModelClient: ModelClient = {
  async complete() {
    throw new Error("the pre-pass guard must pre-empt the model on an empty body");
  },
};

let repo: TempRepo;

function writeIntents(): void {
  repo.write("dusk.config.yml", "version: 1\n");
  repo.write(
    `.ia/intents/${PARENT}/intent.yaml`,
    `id: ${PARENT}\ndescription: send a notification\nobligation: must\ntriples:\n  - id: persist-first\n    subject: the writer\n    predicate: persists\n    object: the row\n`,
  );
  repo.write(
    `.ia/intents/${TEST_INTENT}/intent.yaml`,
    `id: ${TEST_INTENT}\ndescription: unit tests for send\nobligation: must\ntriples:\n  - id: covers-persist-first\n    subject: the test\n    predicate: verifies\n    object: persist-first\n`,
  );
}

beforeAll(() => {
  repo = createTempRepo({ git: false });
  writeIntents();
});
afterAll(() => repo.cleanup());

describe("D.32 — gate rejects @intent on a test-suffix intent at write time", () => {
  const gate = (file: string, content: string) => runGate({ tool: "Write", args: { file_path: join(repo.dir, file), content } });

  test("a focal @intent claiming the test-suffix intent is BLOCKED", () => {
    const out = gate("src/send.unit.ts", `// @intent ${TEST_INTENT} [covers-persist-first]\nexport const t = 1;\n`);
    expect(out.decision).toBe("block");
    if (out.decision !== "block") return;
    expect(out.structured_rejection.kind).toBe("non_test_marker_on_test_intent");
  });

  test("the correct @intent-test-file claim is APPROVED", () => {
    const out = gate("src/send.unit.ts", `// @intent-test-file ${TEST_INTENT}\nexport const t = 1;\n`);
    expect(out.decision).toBe("approve");
  });
});

describe("D.32 — a mis-decorated test routes to the pre-pass and fails loud (never silent accept)", () => {
  test("@intent-only test → route is the pre-pass; pre-pass fails test_intent_no_test_marker with NO model call", async () => {
    // The Engineer slipped past guidance and stamped @intent (focal, non-test).
    repo.write("src/send.unit.ts", `// @intent ${TEST_INTENT} [covers-persist-first]\nexport const t = 1;\n`);
    const ctx = loadProjectContext(repo.dir);

    // Routing follows the authored suffix, not the (empty) marker discovery.
    expect(ctx.index.testDiscovery(TEST_INTENT)).toHaveLength(0);
    expect(chooseVerifierRoute(TEST_INTENT, ctx.index, ctx.config)).toBe("prepass");

    const result = await realTestPrepassVerdict(TEST_INTENT, {
      index: ctx.index,
      intents: ctx.intents,
      readFile: ctx.readFile,
      modelClient: throwingModelClient,
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error.kind).toBe("test_intent_no_test_marker");
    expect(result.error.recoverable).toBe(true);
  });
});

describe("D.32 — under the invariant the suffix-based and marker-based consumers agree", () => {
  test("a correctly @intent-test-file-decorated test is found by suffix AND by marker, consistently", () => {
    repo.write("src/send.unit.ts", `// @intent-test-file ${TEST_INTENT}\nexport const t = 1;\n`);
    const ctx = loadProjectContext(repo.dir);

    // suffix-based identity (routing / inspect)
    expect(isTestIntentPath(TEST_INTENT, ctx.config)).toBe(true);
    expect(chooseVerifierRoute(TEST_INTENT, ctx.index, ctx.config)).toBe("prepass");
    // marker-based body location (pre-pass / test-runner)
    expect(ctx.index.testDiscovery(TEST_INTENT).length).toBeGreaterThan(0);
    // pyramid-layer rollup (Stage-2 consumer) sees the same child under the suffix
    const byLayer = ctx.index.testChildrenByLayer(PARENT, testPyramidSuffixes(ctx.config));
    expect(byLayer["unit-tests"]?.length ?? 0).toBeGreaterThan(0);
  });
});
