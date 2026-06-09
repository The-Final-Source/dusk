import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROLE_FILES = [
  "dusk-root",
  "dusk-bead",
  "dusk-decomposer",
  "dusk-scout",
  "dusk-engineer",
  "dusk-verifier",
  "dusk-test-runner",
  "dusk-author",
  "dusk-conflict-resolver",
] as const;

const DEFAULT_CONFIG = `version: 1

intents:
  dir: .ia/intents

test_pyramid:
  suffixes: [unit-tests, integration-tests, e2e-tests]
`;

/** Create the `.ia/*` + `.claude/agents` scaffold and a default dusk.config.yml. Idempotent. */
export function scaffoldProject(root: string): void {
  for (const dir of [
    ".ia/intents",
    ".ia/runtime/beads",
    ".ia/runtime/dialogs",
    ".ia/runtime/session",
    ".ia/runtime/implement",
    ".ia/observability",
    ".claude/agents",
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  const configPath = join(root, "dusk.config.yml");
  if (!existsSync(configPath)) writeFileSync(configPath, DEFAULT_CONFIG, "utf8");

  for (const role of ROLE_FILES) {
    const path = join(root, ".claude/agents", `${role}.md`);
    if (!existsSync(path)) writeFileSync(path, `---\ndusk_role_version: 2\nname: ${role}\n---\n\n# ${role}\n\n(role stub — filled in Phase 2)\n`, "utf8");
  }
}
