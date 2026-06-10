/**
 * Advisory tool scoping (RFC §9.4, §9.7). The role frontmatter's `tools:` list is
 * passed to the Task tool as configuration only — Dusk does NOT hard-sandbox tool
 * calls. The PreToolUse gate (Phase 1) remains the real safety boundary for
 * writes; skill loads + this scope are auditable post-hoc via `SubAgentTrace`.
 */
export type ToolScope = {
  tools: string[];
  /** v1 is always advisory — there is no hard sandbox. */
  advisory: true;
};

/** Resolve the advisory tool scope for a role from its declared `tools:` list. */
export function resolveToolScope(declaredTools: readonly string[] | undefined): ToolScope {
  return { tools: [...(declaredTools ?? [])], advisory: true };
}
