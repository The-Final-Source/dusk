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

const write = (content: string) => ({ tool: "Write", args: { file_path: join(repo.dir, "src/foo.ts"), content } });

describe("PreToolUse hook process", () => {
  test("approves a clean decorated write (P1-T9)", () => {
    const content = `// @intent api/x [a]\nexport function f() {\n  // @intent api/x [a]\n  const v = go();\n}\n`;
    const result = invokeHook(CLI, write(content));
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({ decision: "approve" });
  });

  test("blocks an unresolved-intent write — exit 2 (the Claude Code block signal) + typed rejection", () => {
    // Production hook contract: a block exits 2 with EMPTY stdout (so Claude Code
    // honors it under every permission mode) and the reason on stderr.
    const hook = invokeHook(CLI, write(`// @intent api/nope [a]\nexport function f() {}\n`));
    expect(hook.exitCode).toBe(2);
    expect(hook.stdout.trim()).toBe("");
    expect(hook.stderr).toContain("unresolved_intent_path");
    // The structured rejection is available via --json (machine-readable mode).
    const json = invokeHook(CLI, write(`// @intent api/nope [a]\nexport function f() {}\n`), { json: true });
    const output = json.output as HookOutput;
    expect(output.decision).toBe("block");
    if (output.decision === "block") expect(output.structured_rejection.kind).toBe("unresolved_intent_path");
  });

  test("fails safe on malformed stdin (P1-T12) — exit 2, empty stdout", () => {
    const result = spawnSync(process.execPath, [CLI], { input: "{ not json", encoding: "utf8" });
    // Fail-SAFE = block = exit 2 + empty stdout (a broken gate must deny, not
    // fail open); the reason is on stderr.
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("hook_internal_error");
    // Structured form via --json.
    const json = spawnSync(process.execPath, [CLI, "--json"], { input: "{ not json", encoding: "utf8" });
    const output = JSON.parse(json.stdout.trim()) as HookOutput;
    expect(output.decision).toBe("block");
    if (output.decision === "block") expect(output.structured_rejection.kind).toBe("hook_internal_error");
  });
});
