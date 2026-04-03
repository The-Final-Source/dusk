import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";

const PKG_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI = join(PKG_ROOT, "dist/cli.js");

const runValidate = (
  filePath: string,
): { stdout: string; exitCode: number } => {
  try {
    const stdout = execSync(`node ${CLI} validate ${filePath}`, {
      encoding: "utf-8",
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; status: number | null };
    return { stdout: e.stdout + e.stderr, exitCode: e.status ?? 1 };
  }
};

describe("dusk validate", () => {
  it("validates a valid block file", () => {
    const result = runValidate(
      join(PKG_ROOT, "fixtures/blocks/api.block.yaml"),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Valid");
  });

  it("validates a valid source-map file", () => {
    const result = runValidate(
      join(PKG_ROOT, "fixtures/example/source-map.json"),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Valid");
  });

  it("validates a valid audit file", () => {
    const result = runValidate(
      join(PKG_ROOT, "fixtures/example/audit.json"),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Valid");
  });

  it("rejects unknown file types", () => {
    const result = runValidate("README.md");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Unknown file type");
  });
});
