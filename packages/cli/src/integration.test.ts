import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const CLI = join(process.cwd(), "dist/cli.js");
const FIXTURES = join(process.cwd(), "fixtures");

const run = (args: string, cwd?: string): { stdout: string; exitCode: number } => {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, {
      encoding: "utf-8",
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return { stdout: (err.stdout || "") + (err.stderr || ""), exitCode: err.status ?? 1 };
  }
};

describe("Sprint 1 Integration", () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "dusk-integration-"));
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  describe("dusk init", () => {
    it("scaffolds project structure", () => {
      const result = run(`init ${projectDir}`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Done");
    });

    it("creates dusk.config.yml with valid content", async () => {
      const config = await readFile(join(projectDir, "dusk.config.yml"), "utf-8");
      expect(config).toContain("version");
      expect(config).toContain("blocks");
    });

    it("creates .ia directory structure", async () => {
      const iaContents = await readdir(join(projectDir, ".ia"));
      expect(iaContents).toContain("intents");
      expect(iaContents).toContain("cache");
      expect(iaContents).toContain("adherence");
    });

    it("is idempotent on re-run", () => {
      const result = run(`init ${projectDir}`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("already exists");
    });
  });

  describe("dusk validate — all fixtures", () => {
    it("validates infrastructure block", () => {
      const result = run(`validate ${join(FIXTURES, "blocks/infrastructure.block.yaml")}`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Valid");
    });

    it("validates data block", () => {
      const result = run(`validate ${join(FIXTURES, "blocks/data.block.yaml")}`);
      expect(result.exitCode).toBe(0);
    });

    it("validates api block", () => {
      const result = run(`validate ${join(FIXTURES, "blocks/api.block.yaml")}`);
      expect(result.exitCode).toBe(0);
    });

    it("validates logic block", () => {
      const result = run(`validate ${join(FIXTURES, "blocks/logic.block.yaml")}`);
      expect(result.exitCode).toBe(0);
    });

    it("validates interaction block", () => {
      const result = run(`validate ${join(FIXTURES, "blocks/interaction.block.yaml")}`);
      expect(result.exitCode).toBe(0);
    });

    it("validates presentation block", () => {
      const result = run(`validate ${join(FIXTURES, "blocks/presentation.block.yaml")}`);
      expect(result.exitCode).toBe(0);
    });

    it("validates example intent", () => {
      const result = run(`validate ${join(FIXTURES, "example/intent.yaml")}`);
      expect(result.exitCode).toBe(0);
    });

    it("validates example source-map", () => {
      const result = run(`validate ${join(FIXTURES, "example/source-map.json")}`);
      expect(result.exitCode).toBe(0);
    });

    it("validates example audit", () => {
      const result = run(`validate ${join(FIXTURES, "example/audit.json")}`);
      expect(result.exitCode).toBe(0);
    });

    it("rejects invalid input with non-zero exit", () => {
      const result = run("validate package.json");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("dusk inspect — fixture blocks and intent", () => {
    it("inspects api block with expected sections", () => {
      const result = run(`inspect ${join(FIXTURES, "blocks/api.block.yaml")}`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Block:");
      expect(result.stdout).toContain("Constraints:");
      expect(result.stdout).toContain("Relationships:");
    });

    it("inspects logic block with constraints", () => {
      const result = run(`inspect ${join(FIXTURES, "blocks/logic.block.yaml")}`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Block:");
      expect(result.stdout).toContain("Constraints:");
    });

    it("inspects example intent with expected sections", () => {
      const result = run(`inspect ${join(FIXTURES, "example/intent.yaml")}`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Intent:");
      expect(result.stdout).toContain("Scope:");
    });

    it("rejects unsupported file with non-zero exit", () => {
      const result = run("inspect README.md");
      expect(result.exitCode).toBe(1);
    });
  });
});
