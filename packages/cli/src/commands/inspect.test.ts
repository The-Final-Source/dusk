import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dirname, "..", "..", "dist", "cli.js");
const FIXTURES = join(import.meta.dirname, "..", "..", "fixtures");

const runInspect = (filePath: string): { stdout: string; exitCode: number } => {
  try {
    const stdout = execSync(`node ${CLI} inspect ${filePath}`, { encoding: "utf-8", env: { ...process.env, FORCE_COLOR: "0" } });
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return { stdout: (err.stdout || "") + (err.stderr || ""), exitCode: err.status ?? 1 };
  }
};

describe("dusk inspect", () => {
  it("inspects a block file with expected sections", () => {
    const result = runInspect(join(FIXTURES, "blocks", "api.block.yaml"));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Block:");
    expect(result.stdout).toContain("Constraints:");
    expect(result.stdout).toContain("must");
  });

  it("inspects an intent file", () => {
    const result = runInspect(join(FIXTURES, "example", "intent.yaml"));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Intent:");
    expect(result.stdout).toContain("Scope:");
  });

  it("rejects unsupported file types", () => {
    const result = runInspect("README.md");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Cannot inspect");
  });
});
