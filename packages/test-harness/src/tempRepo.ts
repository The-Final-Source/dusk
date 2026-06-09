import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type TempRepo = {
  dir: string;
  write: (relativePath: string, content: string) => void;
  read: (relativePath: string) => string;
  exists: (relativePath: string) => boolean;
  cleanup: () => void;
};

export type TempRepoOptions = {
  git?: boolean;
  files?: Record<string, string>;
};

/**
 * Materialize a throwaway repository on the real file system for integration tests.
 * Optionally `git init`s it and seeds files. Caller is responsible for `cleanup()`.
 */
export function createTempRepo(options: TempRepoOptions = {}): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), "dusk-test-"));
  const write = (relativePath: string, content: string): void => {
    const full = join(dir, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  };
  const read = (relativePath: string): string => readFileSync(join(dir, relativePath), "utf8");
  const exists = (relativePath: string): boolean => existsSync(join(dir, relativePath));
  const cleanup = (): void => rmSync(dir, { recursive: true, force: true });

  if (options.git !== false) {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@dusk.dev"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Dusk Test"], { cwd: dir });
  }
  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    write(relativePath, content);
  }
  return { dir, write, read, exists, cleanup };
}
