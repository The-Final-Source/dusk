import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { createTempRepo, invokeHook, type TempRepo } from "@dusk/test-harness";

import type { HookOutput } from "./rejections.js";
import { normalizeHookInput } from "./runGate.js";

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

// Claude Code's REAL PreToolUse payload shape: `tool_name` / `tool_input`.
const write = (content: string) => ({ tool_name: "Write", tool_input: { file_path: join(repo.dir, "src/foo.ts"), content } });

describe("PreToolUse hook process", () => {
  test("approves a clean decorated write (P1-T9)", () => {
    const content = `// @intent api/x [a]\nexport function f() {\n  // @intent api/x [a]\n  const v = go();\n}\n`;
    const result = invokeHook(CLI, write(content));
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({ decision: "approve" });
  });

  test("blocks an unresolved-intent write with the typed rejection", () => {
    const result = invokeHook(CLI, write(`// @intent api/nope [a]\nexport function f() {}\n`));
    expect(result.exitCode).toBe(0);
    const output = result.output as HookOutput;
    expect(output.decision).toBe("block");
    if (output.decision === "block") expect(output.structured_rejection.kind).toBe("unresolved_intent_path");
  });

  test("the real Claude Code tool_name/tool_input payload does NOT crash-block (regression)", () => {
    // A non-gated file: with the input-contract bug this threw before the file
    // filter and fail-safe blocked EVERY write; normalized, it approves.
    const result = invokeHook(CLI, { tool_name: "Write", tool_input: { file_path: join(repo.dir, "notes.md"), content: "# hi\n" } });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({ decision: "approve" });
  });

  test("still accepts the legacy tool/args alias (back-compat)", () => {
    const content = `// @intent api/x [a]\nexport function f() {\n  // @intent api/x [a]\n  const v = go();\n}\n`;
    const result = invokeHook(CLI, { tool: "Write", args: { file_path: join(repo.dir, "src/foo.ts"), content } });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({ decision: "approve" });
  });

  test("fails safe on malformed stdin (P1-T12)", () => {
    const result = spawnSync(process.execPath, [CLI], { input: "{ not json", encoding: "utf8" });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim()) as HookOutput;
    expect(output.decision).toBe("block");
    if (output.decision === "block") expect(output.structured_rejection.kind).toBe("hook_internal_error");
  });
});

describe("normalizeHookInput — the stdin boundary adapter", () => {
  test("maps Claude Code's tool_name/tool_input to the internal tool/args", () => {
    const out = normalizeHookInput({ tool_name: "Edit", tool_input: { file_path: "a.ts", content: "x" }, session_id: "s1" });
    expect(out).toEqual({ tool: "Edit", args: { file_path: "a.ts", content: "x" }, session_id: "s1" });
  });

  test("accepts the legacy tool/args alias unchanged", () => {
    const out = normalizeHookInput({ tool: "Write", args: { file_path: "b.ts" } });
    expect(out.tool).toBe("Write");
    expect(out.args.file_path).toBe("b.ts");
  });

  test("a payload with no tool_input/args yields an empty path (gate approves, never crash-blocks)", () => {
    const out = normalizeHookInput({ tool_name: "Write" });
    expect(out.args.file_path).toBe("");
  });
});
