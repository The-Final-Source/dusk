import { SUB_AGENT_ROLES, type SubAgentRole } from "@dusk/core-schema";
import { loadRoleFile } from "@dusk/runtime-orchestrator";

export type RoleSummary = { role: string; memory: string; model: string; skillCount: number };

/** Enumerate the nine installed role files with their declared scopes (stable order). */
export function listRoles(root: string): RoleSummary[] {
  return (SUB_AGENT_ROLES as readonly SubAgentRole[]).map((role) => {
    const loaded = loadRoleFile(root, role);
    if (!loaded.success) return { role, memory: "(missing)", model: "(missing)", skillCount: 0 };
    const fm = loaded.value.frontmatter;
    return { role, memory: fm.memory, model: fm.model ?? "(default)", skillCount: fm.skills.length };
  });
}

export function renderRoles(summaries: RoleSummary[]): string {
  const lines = summaries.map((s) => `  dusk-${s.role.padEnd(20)} memory=${s.memory.padEnd(8)} model=${s.model.padEnd(20)} skills=${s.skillCount}`);
  return `Installed roles (${summaries.length}):\n${lines.join("\n")}\n`;
}
