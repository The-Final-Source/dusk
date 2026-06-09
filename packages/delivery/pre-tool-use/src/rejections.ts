/** The 12 mechanical rejection kinds (RFC App. A.8) plus the fail-safe kind. */
export const REJECTION_KINDS = [
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

export type HookInput = {
  tool: "Write" | "Edit";
  args: {
    file_path: string;
    content?: string;
    edits?: Array<{ old_string: string; new_string: string; replace_all?: boolean }>;
  };
  session_id?: string;
  transcript_path?: string;
};

export type HookOutput =
  | { decision: "approve"; warnings?: GateWarning[] }
  | { decision: "block"; reason: string; structured_rejection: Rejection; warnings?: GateWarning[] };
