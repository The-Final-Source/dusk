/**
 * The 18 mechanical rejection kinds (12 from RFC App. A.8 + 5 from D.28
 * universal-decoration-coverage + 1 from D.32 test-pyramid-routing) plus the
 * fail-safe kind — 19 entries. The D.28 coverage kinds and the D.32 reverse-of-
 * Check-9 kind are gate-only and NOT part of the v1 10-check→12-kind matrix, so
 * the v1 count of 12 still stands (App. A.8 carries a v1.x note pointing here).
 */
export const REJECTION_KINDS = [
  // 12 from RFC App. A.8
  "missing_decorator",
  "missing_statement_decorator",
  "unresolved_intent_path",
  "unresolved_aspect_id",
  "multiple_intents_on_one_line",
  "missing_ignore_because",
  "missing_ignore_reason",
  "invalid_ignore_predicate",
  "missing_support_triple",
  "malformed_support_triple",
  "focal_and_support_for_same_intent",
  "non_test_path_on_intent_test",
  // 5 from D.28 universal-decoration-coverage (comment-less sidecar coverage)
  "malformed_sidecar",
  "sidecar_target_missing",
  "unresolved_anchor",
  "overlapping_anchors",
  "uncovered_target_lines",
  // 1 from D.32 test-pyramid-routing — the reverse of Check 9 (a focal non-test
  // marker may not claim a test-suffix intent; gate-only, v1.x)
  "non_test_marker_on_test_intent",
  // fail-safe
  "hook_internal_error",
] as const;
export type RejectionKind = (typeof REJECTION_KINDS)[number];

export type Rejection = {
  kind: RejectionKind;
  file: string;
  line: number;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
};

export type GateWarning = { kind: string; file: string; line: number; message: string };

/**
 * The tools the gate's matcher routes to it. `MultiEdit` matches the
 * `Write|Edit|MultiEdit` matcher (it carries `edits[]` like Edit). `tool` is
 * INFORMATIONAL only — `runGate` keys off `file_path`/`content`/`edits`, never
 * the tool name.
 */
export type ToolName = "Write" | "Edit" | "MultiEdit";

export type HookInput = {
  tool?: ToolName;
  args: {
    file_path: string;
    content?: string;
    edits?: Array<{ old_string: string; new_string: string; replace_all?: boolean }>;
  };
  session_id?: string;
  transcript_path?: string;
};

/**
 * Normalize a raw PreToolUse payload into the internal `HookInput`. Claude Code
 * sends `{ hook_event_name, tool_name, tool_input: { file_path, content?, edits? } }`;
 * programmatic/test callers use the internal `{ tool, args }` shape. We accept
 * BOTH (the `??` order prefers the internal shape, so existing callers are
 * unchanged). If neither carries a `file_path`, the result has `file_path:
 * undefined`; `isGatedFile` then returns false and `runGate` approves — safe
 * because a real Write/Edit/MultiEdit ALWAYS carries `file_path`, so a missing
 * one is not a gated code write. Genuinely broken input (unparseable JSON, a
 * thrown error) fails SAFE to a block via the `cli.ts` catch — never a crash.
 *
 * This adapter is why the live hook works at all: before it, `cli.ts` fed the
 * raw `{ tool_name, tool_input }` payload straight to `runGate`, which read
 * `input.args.file_path` on an `undefined` `args` → TypeError → fail-safe block
 * on EVERY real write (the gate fired into a crash).
 */
export function normalizeHookInput(raw: unknown): HookInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const tool = (r.tool ?? r.tool_name) as ToolName | undefined;
  const ti = (r.args ?? r.tool_input ?? {}) as HookInput["args"];
  return {
    tool,
    args: { file_path: ti.file_path, content: ti.content, edits: ti.edits },
    session_id: r.session_id as string | undefined,
    transcript_path: r.transcript_path as string | undefined,
  };
}

/**
 * The single definition of which files the gate enforces over — `.ts`/`.tsx`
 * (excluding generated `.d.ts` declarations) and `.intent` files. The SSoT so
 * the CLI gate (`runGate`) and the headless-engineer post-hoc gate (the
 * `implement` git-status scan) can never disagree on WHICH files to check.
 */
export function isGatedFile(filePath: string): boolean {
  if (!filePath) return false;
  if (filePath.endsWith(".intent")) return true;
  return /\.(ts|tsx)$/.test(filePath) && !filePath.endsWith(".d.ts");
}

export type HookOutput =
  | { decision: "approve"; warnings?: GateWarning[] }
  | { decision: "block"; reason: string; structured_rejection: Rejection; warnings?: GateWarning[] };
