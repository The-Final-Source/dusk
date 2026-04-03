import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access, constants } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

describe("dusk init", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dusk-init-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const runInit = (dir: string) => {
    return execSync(`node ${join(process.cwd(), "packages/cli/dist/cli.js")} init ${dir}`, {
      encoding: "utf-8",
      cwd: tempDir,
    });
  };

  it("scaffolds correct directory structure", async () => {
    const targetDir = join(tempDir, "project");
    runInit(targetDir);

    // Check config exists
    const config = await readFile(join(targetDir, "dusk.config.yml"), "utf-8");
    expect(config).toContain("version");
    expect(config).toContain("blocks");

    // Check directories exist
    await access(join(targetDir, ".ia", "intents"), constants.F_OK);
    await access(join(targetDir, ".ia", "cache"), constants.F_OK);
    await access(join(targetDir, ".ia", "adherence"), constants.F_OK);
  });

  it("is idempotent on re-run", async () => {
    const targetDir = join(tempDir, "project");
    runInit(targetDir);
    const configBefore = await readFile(join(targetDir, "dusk.config.yml"), "utf-8");

    // Run again
    const output = runInit(targetDir);
    const configAfter = await readFile(join(targetDir, "dusk.config.yml"), "utf-8");

    expect(configBefore).toBe(configAfter);
    expect(output).toContain("already exists");
  });
});
