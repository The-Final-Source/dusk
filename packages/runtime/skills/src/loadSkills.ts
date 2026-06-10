import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Advisory skill injection (RFC §9.4/§9.7). Only the skills NAMED in a role's
 * frontmatter are loaded and injected — extra files under the role's skill
 * directory are ignored. Skill names are fully-qualified paths
 * (`dusk/<role>/<skill>`) and resolve to `.claude/skills/<name>.md`.
 */

export type LoadedSkill = {
  /** Fully-qualified skill name, e.g. `dusk/engineer/decoration-completeness`. */
  name: string;
  /** The skill body (frontmatter stripped), or empty when the file is absent. */
  body: string;
  found: boolean;
};

const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;

/** Strip a leading YAML frontmatter block; the body is what gets injected. */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER, "").trim();
}

export function skillFilePath(rootDir: string, skillName: string): string {
  return join(rootDir, ".claude/skills", `${skillName}.md`);
}

/** Load exactly the declared skills (in order). Missing files are surfaced as `found: false`. */
export function loadSkills(rootDir: string, skillNames: readonly string[]): LoadedSkill[] {
  return skillNames.map((name) => {
    const path = skillFilePath(rootDir, name);
    if (!existsSync(path)) return { name, body: "", found: false };
    return { name, body: stripFrontmatter(readFileSync(path, "utf8")), found: true };
  });
}

/** Concatenate loaded skill bodies into a single injectable block. */
export function renderSkillsBlock(skills: readonly LoadedSkill[]): string {
  const present = skills.filter((s) => s.found && s.body.length > 0);
  if (present.length === 0) return "";
  return present.map((s) => `### Skill: ${s.name}\n\n${s.body}`).join("\n\n");
}
