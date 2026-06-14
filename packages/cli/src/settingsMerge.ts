export const DUSK_MARKER = "dusk-pre-tool-use-gate";
export const DUSK_MANAGED = "v1";

export type ConflictChoice = "append" | "replace" | "abort";
/** Resolve a conflict with an existing non-Dusk Write/Edit hook. The real CLI prompts; tests inject. */
export type ConflictResolver = (existingCommand: string) => ConflictChoice;

export type MergeAction = "installed" | "idempotent" | "appended" | "replaced" | "aborted";
export type MergeResult = { settings: Record<string, unknown>; action: MergeAction; backup?: Record<string, unknown> };

type CommandHook = { type?: string; command?: string };
type HookEntry = Record<string, unknown> & {
  matcher?: string;
  hooks?: CommandHook[];
  _dusk_marker?: string;
  // Legacy (pre-fix) shape, still recognized for conflict detection / migration.
  type?: string;
  command?: string;
  match?: { tools?: string[] };
};

/**
 * The Claude Code PreToolUse hook entry shape: `{ matcher: "<toolRegex>", hooks:
 * [{ type: "command", command }] }`. (The earlier `{ match: { tools }, type,
 * command }` shape was NOT recognized by Claude Code — the hook never fired, so
 * the gate failed OPEN. Fixed to the real schema.)
 */
function duskEntry(command: string): HookEntry {
  return { _dusk_managed: DUSK_MANAGED, _dusk_marker: DUSK_MARKER, matcher: "Write|Edit", hooks: [{ type: "command", command }] };
}

/** The command of a hook entry, reading the Claude Code shape first, then the legacy flat shape. */
export function hookEntryCommand(entry: HookEntry): string {
  return String(entry.hooks?.find((h) => h.type === "command")?.command ?? entry.command ?? "");
}

function matchesWriteEdit(entry: HookEntry): boolean {
  // Claude Code shape: a `matcher` regex that hits Write or Edit.
  if (typeof entry.matcher === "string" && /write|edit/i.test(entry.matcher)) return true;
  // Legacy shape: a flat command entry scoped to Write/Edit tools.
  const tools = entry.match?.tools ?? [];
  return entry.type === "command" && (tools.includes("Write") || tools.includes("Edit"));
}

/**
 * Idempotently merge the Dusk PreToolUse hook into a settings object, matched by `_dusk_marker`
 * (never by array position). On conflict with a foreign Write/Edit hook, the resolver chooses
 * append / replace (with backup) / abort. Never silently clobbers.
 */
export function mergeHook(settings: Record<string, unknown>, hookCommand: string, resolver: ConflictResolver): MergeResult {
  const next = JSON.parse(JSON.stringify(settings ?? {})) as Record<string, unknown>;
  const hooks = (next.hooks ?? {}) as Record<string, unknown>;
  next.hooks = hooks;
  const list = (Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : []) as HookEntry[];
  hooks.PreToolUse = list;

  const existingIndex = list.findIndex((entry) => entry?._dusk_marker === DUSK_MARKER);
  if (existingIndex >= 0) {
    list[existingIndex] = duskEntry(hookCommand);
    return { settings: next, action: "idempotent" };
  }

  const foreign = list.find((entry) => matchesWriteEdit(entry));
  if (foreign) {
    const foreignCommand = hookEntryCommand(foreign);
    const choice = resolver(foreignCommand);
    if (choice === "abort") return { settings, action: "aborted" };
    if (choice === "replace") {
      const backup = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
      hooks.PreToolUse = [...list.filter((entry) => entry !== foreign), { ...duskEntry(hookCommand), _dusk_replaced: foreignCommand }];
      return { settings: next, action: "replaced", backup };
    }
    list.push(duskEntry(hookCommand));
    return { settings: next, action: "appended" };
  }

  list.push(duskEntry(hookCommand));
  return { settings: next, action: "installed" };
}
