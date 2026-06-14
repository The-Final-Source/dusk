export const DUSK_MARKER = "dusk-pre-tool-use-gate";
// Bumped v1 → v2 when the entry shape changed to the Claude Code `{ matcher,
// hooks }` schema. v1 was stamped on the OLD `{ match, type, command }` shape
// (which Claude Code never fired), so checkHook gates on this version + the
// firing-shape check to reject stale v1 installs instead of green-lighting them.
export const DUSK_MANAGED = "v2";

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
  // MultiEdit matches the matcher substring and writes code — it MUST be gated;
  // listing it explicitly is honest about what the gate receives.
  return { _dusk_managed: DUSK_MANAGED, _dusk_marker: DUSK_MARKER, matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command }] };
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
 * Is this the exact entry shape Claude Code will FIRE — a top-level `matcher`
 * regex hitting write/edit AND a `hooks[]` array carrying a command? This is the
 * load-bearing check `checkHook` uses: `matchesWriteEdit` is NOT sufficient
 * because it returns true for the legacy `{ match: { tools } }` shape that Claude
 * Code silently never fired (the exact bug this guards against re-shipping).
 */
export function isClaudeCodeFiringShape(entry: HookEntry): boolean {
  const matcherHits = typeof entry.matcher === "string" && /write|edit/i.test(entry.matcher);
  const hasCommandHook = Array.isArray(entry.hooks) && entry.hooks.some((h) => h.type === "command" && typeof h.command === "string" && h.command.length > 0);
  return matcherHits && hasCommandHook;
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
