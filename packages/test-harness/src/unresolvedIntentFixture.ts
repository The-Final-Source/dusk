import { createTempRepo, type TempRepo, type TempRepoOptions } from "./tempRepo.js";

/**
 * A repo fixture whose request walks into a MISSING intent reference (the
 * Decomposer's `implement_paused_for_authoring` escalation; §5.4 / P4-T8).
 * The parent `api/pagination/cursor-only` exists with a `cursor-decode` sibling
 * and an `implies` edge to the absent `cursor-encode` leaf — exactly design D4's
 * worked example for `enrichDialogSeed`.
 */

export type UnresolvedIntentFixture = {
  repo: TempRepo;
  /** The request that resolves to the parent and walks into the missing leaf. */
  request: string;
  unresolvedRef: string;
  parentPath: string;
  siblingPath: string;
};

const PARENT_INTENT = `schema_version: 2
id: api/pagination/cursor-only
description: List pagination is cursor-based; cursors are opaque tokens.
obligation: must
compose: all
triples:
  - id: cursor-param
    subject: list endpoints
    predicate: accept
    object: a single opaque cursor query parameter
relates_to:
  - kind: implies
    target: api/pagination/cursor-only/cursor-encode
`;

const SIBLING_INTENT = `schema_version: 2
id: api/pagination/cursor-only/cursor-decode
description: Cursor decoding validates input and produces a typed state.
obligation: must
compose: all
triples:
  - id: query-param
    subject: the cursor decode function
    predicate: accept
    object: a single string query parameter named cursor
  - id: return-payload
    subject: the cursor decode function
    predicate: return
    object: a typed CursorState or a typed DecodeError
`;

export function createMockUnresolvedIntentFixture(options: TempRepoOptions = {}): UnresolvedIntentFixture {
  const repo = createTempRepo({
    ...options,
    files: {
      ".ia/intents/api/pagination/cursor-only/intent.yaml": PARENT_INTENT,
      ".ia/intents/api/pagination/cursor-only/cursor-decode/intent.yaml": SIBLING_INTENT,
      ...(options.files ?? {}),
    },
  });
  return {
    repo,
    request: "add cursor encoding for paginated lists (api/pagination/cursor-only)",
    unresolvedRef: "api/pagination/cursor-only/cursor-encode",
    parentPath: "api/pagination/cursor-only",
    siblingPath: "api/pagination/cursor-only/cursor-decode",
  };
}
