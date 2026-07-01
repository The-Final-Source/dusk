import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Build provenance for the `dusk` CLI. `dist/buildInfo.json` is written by
 * `scripts/stampBuild.mjs` at build time, capturing the git commit/branch/dirty
 * state of THIS build — so `dusk version` reports exactly which code is running,
 * not the repo's current HEAD (they diverge the instant you switch branches
 * without rebuilding — the stale-build footgun that let a pre-fix engine run).
 */

export type BuildInfo = { sha: string; branch: string; dirty: boolean; builtAt: string };

const distDir = (): string => dirname(fileURLToPath(import.meta.url));

function liveHead(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export const VERSION_HELP =
  "dusk version\n  Print the build's git provenance — the commit/branch this CLI was compiled\n  from, whether that build included uncommitted changes, and whether it is STALE\n  vs the repo's current HEAD (i.e. needs a rebuild). Use this before a long run to\n  confirm you're exercising the code you think you are.\n";

/** Render the build provenance + a staleness check against the live repo HEAD. */
export function renderVersion(): string {
  const dist = distDir();
  const infoPath = join(dist, "buildInfo.json");
  if (!existsSync(infoPath)) {
    return "dusk: build provenance unavailable (no dist/buildInfo.json). Rebuild: pnpm --filter @dusk/cli build\n";
  }
  let info: BuildInfo;
  try {
    info = JSON.parse(readFileSync(infoPath, "utf8")) as BuildInfo;
  } catch {
    return "dusk: build provenance unreadable (corrupt dist/buildInfo.json). Rebuild: pnpm --filter @dusk/cli build\n";
  }
  return formatVersion(info, liveHead(dist));
}

/** Pure formatter (no IO) — the provenance lines + staleness verdict. */
export function formatVersion(info: BuildInfo, head: string | null): string {
  const lines = [
    "dusk CLI — build provenance",
    `  built from: ${info.sha ? info.sha.slice(0, 10) : "unknown"} (${info.branch || "?"})${info.dirty ? "  ⚠ +dirty (build included uncommitted changes — not pinned to a commit)" : ""}`,
    `  built at:   ${info.builtAt}`,
  ];
  if (!head || !info.sha) {
    lines.push("  status:     (cannot compare to repo HEAD)");
  } else if (head === info.sha) {
    lines.push(`  status:     ✓ matches current repo HEAD${info.dirty ? " (but built dirty — rebuild for an exact-commit guarantee)" : ""}`);
  } else {
    lines.push(`  status:     ⚠ STALE — repo HEAD is now ${head.slice(0, 10)} but this CLI was built from ${info.sha.slice(0, 10)}.`);
    lines.push("              Rebuild before relying on it: pnpm --filter @dusk/cli build");
  }
  return `${lines.join("\n")}\n`;
}
