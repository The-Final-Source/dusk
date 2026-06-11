import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CONFIG = `version: 1

intents:
  dir: .ia/intents

test_pyramid:
  suffixes: [unit-tests, integration-tests, e2e-tests]
`;

/** Bundled canonical role files + skills (shipped with the CLI). */
export function assetsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
}

/** Create the `.ia/*` scaffold, install the canonical agents + skills, and a default config. Idempotent. */
export function scaffoldProject(root: string): void {
  for (const dir of [
    ".ia/intents",
    ".ia/runtime/beads",
    ".ia/runtime/dialogs",
    ".ia/runtime/session",
    ".ia/runtime/implement",
    ".ia/observability",
    ".claude/agents",
    ".claude/skills/dusk",
    ".claude/commands",
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  const configPath = join(root, "dusk.config.yml");
  if (!existsSync(configPath)) writeFileSync(configPath, DEFAULT_CONFIG, "utf8");

  // Install the nine role files, the role-bound skills, and the slash commands
  // (/dusk-author) from the bundled assets.
  const assets = assetsDir();
  cpSync(join(assets, "agents"), join(root, ".claude/agents"), { recursive: true });
  cpSync(join(assets, "skills", "dusk"), join(root, ".claude/skills/dusk"), { recursive: true });
  cpSync(join(assets, "commands"), join(root, ".claude/commands"), { recursive: true });
}
