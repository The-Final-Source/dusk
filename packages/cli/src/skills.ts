import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Introspect installed role-bound skills, grouped by the `.claude/skills/dusk/<role>/` layout. */
export function listSkills(root: string): Record<string, string[]> {
  const base = join(root, ".claude/skills/dusk");
  if (!existsSync(base)) return {};
  const out: Record<string, string[]> = {};
  for (const roleDir of readdirSync(base).sort()) {
    const dir = join(base, roleDir);
    if (!statSync(dir).isDirectory()) continue;
    out[roleDir] = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
  }
  return out;
}

export function renderSkills(grouped: Record<string, string[]>): string {
  const roles = Object.keys(grouped);
  if (roles.length === 0) return "No skills installed (run `dusk init`).\n";
  const blocks = roles.map((role) => `  ${role}/\n${grouped[role].map((s) => `    - ${s}`).join("\n")}`);
  return `Installed skills:\n${blocks.join("\n")}\n`;
}
