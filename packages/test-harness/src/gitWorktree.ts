import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * `MockGitWorktree` (task 1.3a) — a REAL git environment for worktree tests.
 * Sets up a bare `origin` + a working clone so `origin/main` resolves (the
 * production worktree base, design Q2), and hands out deterministic bead-ids in
 * the App. D.8 format so branch names are reproducible across runs. The worktree
 * package's own functions are exercised against `repoDir`; `createWorktree` is a
 * convenience for tests that need a pre-existing (or orphaned) worktree.
 */

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

export type WorktreeHandle = { beadId: string; branch: string; path: string };

export type MockGitWorktree = {
  /** Working clone that has `origin/main`. */
  repoDir: string;
  /** The bare origin backing `origin/main`. */
  originDir: string;
  /** Deterministic id generator: `bd_<14-digit base><3-digit seq>`. */
  nextBeadId: () => string;
  /** Create a `dusk/<beadId>` worktree off `origin/main` with REAL git. */
  createWorktree: (beadId?: string) => WorktreeHandle;
  /** Local branch names matching `dusk/bd_*`. */
  listDuskBranches: () => string[];
  /** Registered worktree paths (excludes the main working tree). */
  worktreePaths: () => string[];
  cleanup: () => void;
};

export type MockGitWorktreeOptions = {
  /** Files seeded into the initial commit on main. */
  files?: Record<string, string>;
  /** 14-digit base timestamp for deterministic bead-ids. */
  idBase?: string;
};

export function createMockGitWorktree(options: MockGitWorktreeOptions = {}): MockGitWorktree {
  const originDir = mkdtempSync(join(tmpdir(), "dusk-origin-"));
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", originDir]);

  const repoDir = mkdtempSync(join(tmpdir(), "dusk-clone-"));
  execFileSync("git", ["clone", "-q", originDir, repoDir]);
  git(repoDir, ["config", "user.email", "test@dusk.dev"]);
  git(repoDir, ["config", "user.name", "Dusk Test"]);
  git(repoDir, ["checkout", "-q", "-b", "main"]);

  const files = options.files ?? { "README.md": "# dusk fixture\n" };
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  git(repoDir, ["add", "-A"]);
  git(repoDir, ["commit", "-q", "-m", "chore: seed fixture"]);
  git(repoDir, ["push", "-q", "origin", "main"]);

  const idBase = options.idBase ?? "20260610000000";
  let seq = 0;
  const nextBeadId = (): string => {
    seq += 1;
    return `bd_${idBase}${String(seq).padStart(3, "0")}`;
  };

  const createWorktree = (beadId: string = nextBeadId()): WorktreeHandle => {
    const branch = `dusk/${beadId}`;
    const path = join(repoDir, ".ia/runtime/worktrees", beadId);
    mkdirSync(dirname(path), { recursive: true });
    git(repoDir, ["worktree", "add", "-q", "-b", branch, path, "origin/main"]);
    return { beadId, branch, path };
  };

  const listDuskBranches = (): string[] => {
    const out = git(repoDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads/dusk"]);
    return out.length === 0 ? [] : out.split("\n").map((l) => l.trim()).filter(Boolean);
  };

  const worktreePaths = (): string[] => {
    const out = git(repoDir, ["worktree", "list", "--porcelain"]);
    const all = out
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length).trim());
    // The first entry is the main worktree (git canonicalizes paths, so a
    // string compare to repoDir is unreliable on macOS /var → /private/var).
    return all.slice(1);
  };

  const cleanup = (): void => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(originDir, { recursive: true, force: true });
  };

  return { repoDir, originDir, nextBeadId, createWorktree, listDuskBranches, worktreePaths, cleanup };
}
