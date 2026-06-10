import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { duskError, type DuskError, type RuntimeResult, type SubAgentRole } from "@dusk/core-schema";
import { MEMORY_SCOPES } from "@dusk/runtime-memory";

/**
 * Role definition frontmatter (RFC §9.5, App. A.9). The runtime refuses to spawn
 * a role whose `dusk_role_version` is outside the supported range (task 2.3).
 */
export const SUPPORTED_ROLE_VERSION = { min: 2, max: 2 } as const;

/**
 * Role files use short slugs (`dusk-root`, `dusk-bead`) while the `SubAgentTrace.role`
 * enum uses the long orchestrator names. `subagent_type` is `dusk-<slug>`.
 */
export const ROLE_FILE_SLUG: Record<SubAgentRole, string> = {
  "root-orchestrator": "root",
  "bead-orchestrator": "bead",
  decomposer: "decomposer",
  scout: "scout",
  engineer: "engineer",
  verifier: "verifier",
  "test-runner": "test-runner",
  author: "author",
  "conflict-resolver": "conflict-resolver",
};

/** The `subagent_type` handed to Claude Code's Task tool for a role. */
export const subagentType = (role: SubAgentRole): string => `dusk-${ROLE_FILE_SLUG[role]}`;

export const RoleFrontmatterSchema = z
  .object({
    dusk_role_version: z.number().int(),
    name: z.string(),
    description: z.string().optional(),
    tools: z.array(z.string()).default([]),
    memory: z.enum(MEMORY_SCOPES),
    skills: z.array(z.string()).default([]),
    model: z.string().optional(),
  })
  .passthrough();
export type RoleFrontmatter = z.infer<typeof RoleFrontmatterSchema>;

export type RoleFile = {
  frontmatter: RoleFrontmatter;
  body: string;
};

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

export function roleFilePath(rootDir: string, role: SubAgentRole): string {
  return join(rootDir, ".claude/agents", `dusk-${ROLE_FILE_SLUG[role]}.md`);
}

/** Read + parse a role file. Missing file / malformed frontmatter → typed error. */
export function loadRoleFile(rootDir: string, role: SubAgentRole): RuntimeResult<RoleFile> {
  const path = roleFilePath(rootDir, role);
  if (!existsSync(path)) {
    return {
      success: false,
      error: duskError("config_invalid", `role file not found for dusk-${role}`, {
        recoverable: false,
        details: { path },
        recovery_hint: "Run `dusk init` to install the role files.",
      }),
    };
  }
  const raw = readFileSync(path, "utf8");
  const match = raw.match(FRONTMATTER);
  if (!match) {
    return {
      success: false,
      error: duskError("config_invalid", `role file dusk-${role} is missing YAML frontmatter`, { recoverable: false, details: { path } }),
    };
  }
  const parsed = RoleFrontmatterSchema.safeParse(parseYaml(match[1]) ?? {});
  if (!parsed.success) {
    return {
      success: false,
      error: duskError("config_invalid", `role file dusk-${role} frontmatter is invalid: ${parsed.error.issues[0]?.message}`, {
        recoverable: false,
        details: { path },
      }),
    };
  }
  return { success: true, value: { frontmatter: parsed.data, body: raw.slice(match[0].length).trim() } };
}

/** Enforce the supported `dusk_role_version` range (task 2.3 / P2-T19). */
export function checkRoleVersion(role: SubAgentRole, frontmatter: RoleFrontmatter): DuskError | null {
  const version = frontmatter.dusk_role_version;
  if (version < SUPPORTED_ROLE_VERSION.min || version > SUPPORTED_ROLE_VERSION.max) {
    return duskError(
      "config_invalid",
      `dusk-${role} declares dusk_role_version ${version}, outside the supported range [${SUPPORTED_ROLE_VERSION.min}, ${SUPPORTED_ROLE_VERSION.max}]`,
      { recoverable: false, details: { role, version, supported: SUPPORTED_ROLE_VERSION } },
    );
  }
  return null;
}
