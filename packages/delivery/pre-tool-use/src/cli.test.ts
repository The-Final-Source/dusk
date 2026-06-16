import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { createTempRepo, invokeHook, type TempRepo } from "@dusk/test-harness";

import type { HookOutput } from "./rejections.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

let repo: TempRepo;
beforeAll(() => {
  repo = createTempRepo({ git: false });
  repo.write("dusk.config.yml", "version: 1\n");
  repo.write(
    ".ia/intents/api/x/intent.yaml",
    `id: api/x\ndescription: d\nobligation: must\ntriples:\n  - id: a\n    subject: s\n    predicate: p\n    object: o\n`,
  );
});
afterAll(() => repo.cleanup());

const DECORATED = `// @intent api/x [a]\nexport function f() {\n  // @intent api/x [a]\n  const v = go();\n}\n`;
const UNRESOLVED = `// @intent api/nope [a]\nexport function f() {}\n`;

// The REAL Claude Code PreToolUse wire payload — `{ hook_event_name, tool_name,
// tool_input }`. The gate MUST work on THIS shape; feeding it the internal
// `{ tool, args }` shape (below) is what let the payload-mismatch bug ship: every
// real write crashed into a fail-safe block (`input.args` was undefined).
const ccWrite = (content: string, file = "src/foo.ts") => ({
  hook_event_name: "PreToolUse",
  tool_name: "Write",
  tool_input: { file_path: join(repo.dir, file), content },
});
// The internal programmatic/test shape — must still work (back-compat).
const internalWrite = (content: string) => ({ tool: "Write", args: { file_path: join(repo.dir, "src/foo.ts"), content } });

describe("PreToolUse hook process — Claude Code wire payload", () => {
  test("approves a clean decorated write — exit 0, EMPTY stdout (the allow IS the exit code)", () => {
    const result = invokeHook(CLI, ccWrite(DECORATED));
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
    // The structured decision is available via --json.
    const json = invokeHook(CLI, ccWrite(DECORATED), { json: true });
    expect((json.output as HookOutput).decision).toBe("approve");
  });

  test("blocks an unresolved-intent write — exit 2, EMPTY stdout, reason on stderr", () => {
    const hook = invokeHook(CLI, ccWrite(UNRESOLVED));
    expect(hook.exitCode).toBe(2);
    expect(hook.stdout.trim()).toBe("");
    expect(hook.stderr).toContain("unresolved_intent_path");
    const json = invokeHook(CLI, ccWrite(UNRESOLVED), { json: true });
    const output = json.output as HookOutput;
    expect(output.decision).toBe("block");
    if (output.decision === "block") expect(output.structured_rejection.kind).toBe("unresolved_intent_path");
  });

  test("is SELECTIVE — a non-gated file (README.md) approves, not a blanket block", () => {
    // Regression guard for the payload-mismatch bug, which fail-safe-blocked
    // EVERY write (even ungated files) because it crashed before the file check.
    const result = invokeHook(CLI, ccWrite("# hello\n", "README.md"));
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  test("MultiEdit is gated too (the matcher routes it in) — decorated approves, undecorated blocks", () => {
    repo.write("src/multi.ts", `// @intent api/x [a]\nexport const seed = 1;\n`);
    // Replace the WHOLE decorated block so the undecorated case truly loses its
    // decorator (editing only the export line would leave the @intent in place).
    const multiEdit = (newDecorated: boolean) => ({
      hook_event_name: "PreToolUse",
      tool_name: "MultiEdit",
      tool_input: {
        file_path: join(repo.dir, "src/multi.ts"),
        edits: [
          {
            old_string: "// @intent api/x [a]\nexport const seed = 1;",
            new_string: newDecorated ? "// @intent api/x [a]\nexport const seed = 2;" : "export const undecorated = 2;",
          },
        ],
      },
    });
    expect(invokeHook(CLI, multiEdit(true)).exitCode).toBe(0);
    const blocked = invokeHook(CLI, multiEdit(false), { json: true });
    expect(blocked.exitCode).toBe(2);
    expect((blocked.output as HookOutput).decision).toBe("block");
  });

  test("a real-shape payload missing file_path resolves cleanly (approve) — does NOT crash into a fail-safe block", () => {
    // The old bug crashed on EVERY payload (input.args undefined → TypeError →
    // fail-safe block). The adapter must resolve cleanly: no file_path → not a
    // gated file → approve (safe; a real Write always carries file_path). What
    // fails CLOSED is a genuine parse error, covered by the malformed-stdin test.
    const malformed = { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { content: "export const x = 1;" } };
    const result = invokeHook(CLI, malformed, { json: true });
    expect(result.exitCode).toBe(0);
    expect((result.output as HookOutput).decision).toBe("approve");
  });

  test("back-compat: the internal { tool, args } shape still works (programmatic callers)", () => {
    const approve = invokeHook(CLI, internalWrite(DECORATED), { json: true });
    expect((approve.output as HookOutput).decision).toBe("approve");
    const block = invokeHook(CLI, internalWrite(UNRESOLVED), { json: true });
    expect((block.output as HookOutput).decision).toBe("block");
  });

  test("fails safe on malformed stdin (P1-T12) — exit 2, empty stdout", () => {
    const result = spawnSync(process.execPath, [CLI], { input: "{ not json", encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("hook_internal_error");
    const json = spawnSync(process.execPath, [CLI, "--json"], { input: "{ not json", encoding: "utf8" });
    const output = JSON.parse(json.stdout.trim()) as HookOutput;
    expect(output.decision).toBe("block");
    if (output.decision === "block") expect(output.structured_rejection.kind).toBe("hook_internal_error");
  });
});
