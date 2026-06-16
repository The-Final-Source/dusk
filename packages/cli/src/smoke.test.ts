import { describe, test, expect } from "vitest";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTempRepo, invokeHook } from "@dusk/test-harness";
import { loadIntentTree } from "@dusk/core-graph";

import { initProject } from "./init.js";
import { validateIntents } from "./validate.js";
import { inspectIntent } from "./inspect.js";
import { checkHook } from "./checkHook.js";
import type { HookOutput } from "@dusk/pre-tool-use";

const GATE = fileURLToPath(new URL("../../delivery/pre-tool-use/dist/cli.js", import.meta.url));
const CANONICAL = fileURLToPath(new URL("../../intents/canonical", import.meta.url));
const hookCommand = `node ${GATE}`;

describe("Phase 1 substrate — end-to-end smoke (phase-landing)", () => {
  test("the canonical intents parse and validate (6 Phase-1 + 3 Phase-2 + 3 Phase-3 + 1 Phase-4)", () => {
    const tree = loadIntentTree(CANONICAL);
    expect(tree.failures).toEqual([]);
    expect(tree.intents.size).toBe(13);
    expect(tree.intents.has("api/pagination/cursor-only/cursor-decode")).toBe(true);
    // Phase-4 addition: the cursor-only PARENT (Stage-2 tension fixture — 10.1).
    expect(tree.intents.has("api/pagination/cursor-only")).toBe(true);
    // Phase-2 additions: negative-polarity, compose: implies, quantifier-bounded.
    expect(tree.intents.has("api/no-offset-pagination")).toBe(true);
    expect(tree.intents.has("api/idempotency-on-writes")).toBe(true);
    expect(tree.intents.has("sync/one-event-per-insert")).toBe(true);
    // Phase-3 additions: file-overlap pair + test-intent fixture.
    expect(tree.intents.has("observability/structured-logging")).toBe(true);
    expect(tree.intents.has("notifications/send/unit-tests")).toBe(true);
  });

  test("substrate end-to-end on a fresh repo: init -> validate -> gate approve/block -> inspect -> check-hook", () => {
    const repo = createTempRepo({ git: false });

    // 1. init installs the gate + scaffold.
    initProject(repo.dir, { hookCommand });

    // 2. drop intents: the canonical set + a notifications/send intent with a unit-tests child.
    cpSync(CANONICAL, join(repo.dir, ".ia/intents"), { recursive: true });
    repo.write(
      ".ia/intents/notifications/send/intent.yaml",
      "id: notifications/send\ndescription: d\nobligation: must\ntriples:\n  - id: persist-first\n    subject: s\n    predicate: persist\n    object: o\n  - id: publish-sync\n    subject: s\n    predicate: publish\n    object: o\n",
    );
    repo.write(
      ".ia/intents/notifications/send/unit-tests/intent.yaml",
      "id: notifications/send/unit-tests\ndescription: d\nobligation: must\ntriples:\n  - id: covers-persist\n    subject: s\n    predicate: include\n    object: o\n",
    );

    // 3. validate all -> green.
    expect(validateIntents(repo.dir).ok).toBe(true);

    // The REAL Claude Code wire payload — the smoke test exercises exactly what
    // the live hook receives in production.
    const writeInput = (content: string) => ({
      hook_event_name: "PreToolUse" as const,
      tool_name: "Write" as const,
      tool_input: { file_path: join(repo.dir, "src/notify.ts"), content },
    });

    // 4. a fully-decorated write is approved by the REAL hook — production
    // contract: exit 0 + EMPTY stdout (the allow IS the exit code).
    const clean = `// @intent notifications/send [persist-first]
export function sendNotification() {
  // @intent-support notifications/send [persist-first] ["the row builder", "constructs", "the rows"]
  const rows = build();
  // @intent notifications/send [publish-sync]
  publish(rows);
}
`;
    const approvedHook = invokeHook(GATE, writeInput(clean));
    expect(approvedHook.exitCode).toBe(0);
    expect(approvedHook.stdout.trim()).toBe("");
    expect(invokeHook(GATE, writeInput(clean), { json: true }).output).toMatchObject({ decision: "approve" });

    // 5. an undecorated statement is blocked with the typed rejection.
    const dirty = `// @intent notifications/send [persist-first]
export function sendNotification() {
  const rows = build();
}
`;
    // The production hook contract: a block exits 2 (the only signal Claude Code
    // honors under every permission mode); --json exposes the structured kind.
    const blockedHook = invokeHook(GATE, writeInput(dirty));
    expect(blockedHook.exitCode).toBe(2);
    const blocked = invokeHook(GATE, writeInput(dirty), { json: true }).output as HookOutput;
    expect(blocked.decision).toBe("block");
    if (blocked.decision === "block") expect(blocked.structured_rejection.kind).toBe("missing_statement_decorator");

    // 6. inspect shows the unsatisfied unit-tests child (no test code yet).
    expect(inspectIntent(repo.dir, "notifications/send")?.unsatisfiedTestChildren).toContain("notifications/send/unit-tests");

    // 7. the hook is installed and round-trips.
    expect(checkHook(repo.dir, { hookCommand }).exitCode).toBe(0);

    repo.cleanup();
  });
});
