import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Post-build: stamp dist/ with the git provenance of THIS build so `dusk version`
// can report exactly which commit the running CLI was compiled from (and warn
// when the build is stale vs the repo). dist/ is gitignored, so this artifact
// never pollutes the tree. Runs after `tsc` (see the cli `build` script).

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const git = (args) => {
  try {
    return execSync(`git ${args}`, { cwd: distDir, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

const sha = git("rev-parse HEAD");
const branch = git("rev-parse --abbrev-ref HEAD");
const dirty = git("status --porcelain").length > 0;
const builtAt = new Date().toISOString();

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, "buildInfo.json"), `${JSON.stringify({ sha, branch, dirty, builtAt }, null, 2)}\n`, "utf8");
process.stderr.write(`stamped dusk build: ${sha.slice(0, 7) || "unknown"} (${branch || "?"})${dirty ? " +dirty" : ""}\n`);
