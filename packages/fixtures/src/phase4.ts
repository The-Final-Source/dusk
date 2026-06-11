import type { DraftIntent } from "@dusk/core-schema";

/**
 * Phase-4 worked-example fixtures (task 10.2) — the inputs the phase-landing
 * smoke matrix (10.3) drives: the unauthored-intent pause (smoke Primary), the
 * conditional-intent authoring request (`compose: implies`), the L2-exhaustion
 * zero-satisfiable bead, and the 24h-aged dialog/checkpoint pair (Variant D).
 * File CONTENT lives here; tests materialize it into temp repos.
 */

/** Smoke Primary: the request that walks into a missing `cursor-encode` leaf. */
export const UNAUTHORED_INTENT_REQUEST = "add cursor encoding for paginated lists";
export const UNAUTHORED_INTENT_SCOPE = ["api/pagination/cursor-only"];
export const UNAUTHORED_REF = "api/pagination/cursor-only/cursor-encode";

export const CURSOR_PARENT_YAML = `schema_version: 2
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

export const CURSOR_DECODE_YAML = `schema_version: 2
id: api/pagination/cursor-only/cursor-decode
description: Cursor decoding validates input and produces a typed state.
obligation: must
compose: all
triples:
  - id: query-param
    subject: the cursor decode function
    predicate: accept
    object: a single string query parameter named cursor
`;

/** Smoke Primary's intent set: impl draft with a `polarity: negative` triple. */
export const SMOKE_IMPL_DRAFT: DraftIntent = {
  id: "api/pagination/cursor-only/cursor-encode",
  description: "Cursor encoding produces an opaque token; offset fallbacks are forbidden.",
  obligation: "must",
  triples: [
    { id: "opaque-token", subject: "the cursor encode function", predicate: "produce", object: "an opaque base64url cursor token", polarity: "positive" },
    { id: "no-offset-fallback", subject: "the cursor encode function", predicate: "emit", object: "an offset-based fallback token", polarity: "negative" },
  ],
};

/** Smoke Primary's conditional companion: `compose: implies` with a closed-vocabulary antecedent. */
export const SMOKE_CONDITIONAL_DRAFT: DraftIntent = {
  id: "api/pagination/cursor-signing",
  description: "Endpoints decorated with cursor-only pagination sign their cursors.",
  obligation: "must",
  compose: "implies",
  antecedent: [{ id: "is-cursor-paged", subject: "the endpoint", predicate: "is decorated with", object: "api/pagination/cursor-only" }],
  consequent: [{ id: "signs-cursor", subject: "the endpoint", predicate: "sign", object: "the cursor token with the service key", polarity: "positive" }],
};

/** The conditional authoring request (Primary's Stage-1 input for the implies intent). */
export const CONDITIONAL_INTENT_REQUEST = "if an endpoint is decorated api/pagination/cursor-only, it must sign its cursor tokens";

/** Variant B: a zero-satisfiable bead's intent (the shape claim is unsatisfiable as phrased). */
export const L2_EXHAUSTION_INTENT_YAML = `schema_version: 2
id: api/widget
description: The widget endpoint returns raw widgets.
obligation: must
compose: all
triples:
  - id: shape
    subject: the widget endpoint
    predicate: return
    object: a raw widget blob
`;

export const L2_EXHAUSTION_DIAGNOSES = [{ iter: 3, text: "the raw-blob shape claim is unsatisfiable as phrased" }];

/** Variant D: dialog/checkpoint ages around the 24h GC window (relative ms). */
export const STALE_AGE_MS = 30 * 60 * 60 * 1000; // 30h — reaped
export const FRESH_AGE_MS = 1 * 60 * 60 * 1000; // 1h — preserved
