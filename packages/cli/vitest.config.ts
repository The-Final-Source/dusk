import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The cli package is integration/E2E-heavy: most of its tests exercise real
    // MANAGED out-of-process dependencies — the filesystem, real `git`
    // worktrees, and the app's own CLI binary's wire contract (exit codes,
    // stdout emptiness, the JSON envelope). Per the classical (non-mockist)
    // school these are kept REAL — mocking them would couple to implementation
    // and erase the very behavior under test (you cannot assert a process exit
    // code or on-disk worktree reaping without the real thing).
    //
    // Vitest's 5s default is a UNIT-test budget. Applying it to subprocess-
    // spawning integration tests is a category error: under `turbo test` the
    // box runs many package suites concurrently, each forking ~CPU-count
    // workers, so a test that takes ~1-3s in isolation can spike past 5s purely
    // on scheduling latency — a FALSE timeout, the worst kind of flake. These
    // tests are deterministic, so a generous-but-bounded budget removes the
    // false failures while STILL catching a genuine hang. 60s matches the
    // repo-wide convention for integration-heavy packages.
    testTimeout: 60_000,
    hookTimeout: 60_000, // beforeEach `git init`/clone setup is also out-of-process
  },
});
