import { describe, test, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createTempRepo } from "./tempRepo.js";
import { invokeHook } from "./invokeHook.js";
import { manualClock } from "./clock.js";

describe("test harness", () => {
  test("createTempRepo materializes a git repo with seeded files", () => {
    const repo = createTempRepo({ files: { ".ia/intents/.keep": "" } });
    try {
      expect(repo.exists(".git")).toBe(true);
      repo.write("dusk.config.yml", "version: 1\n");
      expect(repo.read("dusk.config.yml")).toContain("version: 1");
      expect(repo.exists(".ia/intents/.keep")).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  test("invokeHook round-trips JSON through a real child process", () => {
    const repo = createTempRepo({ git: false });
    try {
      const bin = join(repo.dir, "hook.cjs");
      writeFileSync(
        bin,
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{process.stdout.write(JSON.stringify({decision:'approve',echo:JSON.parse(s).tool}))});",
      );
      const result = invokeHook(bin, { tool: "Write" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toEqual({ decision: "approve", echo: "Write" });
    } finally {
      repo.cleanup();
    }
  });

  test("manualClock advances deterministically", () => {
    const clock = manualClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
  });
});
