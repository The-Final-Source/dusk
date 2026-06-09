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

  test("blocks an unresolved-intent write with the typed rejection", () => {
    const result = invokeHook(CLI, write(`// @intent api/nope [a]\nexport function f() {}\n`));
    expect(result.exitCode).toBe(0);
    const output = result.output as HookOutput;
    expect(output.decision).toBe("block");
    if (output.decision === "block") expect(output.structured_rejection.kind).toBe("unresolved_intent_path");
  });

  test("fails safe on malformed stdin (P1-T12)", () => {
    const result = spawnSync(process.execPath, [CLI], { input: "{ not json", encoding: "utf8" });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim()) as HookOutput;
    expect(output.decision).toBe("block");
    if (output.decision === "block") expect(output.structured_rejection.kind).toBe("hook_internal_error");
  });
});
