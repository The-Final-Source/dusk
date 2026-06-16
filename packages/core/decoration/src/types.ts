export type DecorationMarker =
  | "intent"
  | "intent-support"
  | "intent-test"
  | "intent-test-file"
  | "intent-file"
  | "intent-ignore";

export type DecorationScope = "declaration" | "statement" | "file" | "directory" | "region";

export type SupportTriple = [subject: string, predicate: string, object: string];

export type IgnoreClause = { because: [string, string, string]; reason: string };

/**
 * Whether a record feeds the semantic Verifier path or the mechanical/structural
 * coverage pass (design D6/D8). Inline + directory `.intent` records are
 * `semantic`; per-file sidecar (comment-less config) records are `structural` and
 * are partitioned out of the semantic consumers at the index boundary.
 */
export type DecorationVerify = "structural" | "semantic";

/** One decoration occurrence (RFC §2.9 / App. A.2; D.28 additive fields). */
export type DecorationRecord = {
  file: string;
  line: number;
  scope: DecorationScope;
  declaration_name: string | null;
  marker: DecorationMarker;
  intent_path: string;
  aspect_ids: string[] | null;
  support_triple: SupportTriple | null;
  ignore_clause: IgnoreClause | null;
  /**
   * JSON Pointer (RFC 6901) for sidecar records; `null`/absent for inline and
   * directory records. Additive: the producing parsers set it concretely
   * (`null` for inline/directory), so existing record literals are unchanged.
   */
  anchor?: string | null;
  /**
   * Semantic (judged by the Verifier) vs structural (mechanical coverage only).
   * Additive with a `semantic` default — absent ≡ `semantic`. Only the per-file
   * sidecar parser emits `structural`, so the default is always safe.
   */
  verify?: DecorationVerify;
};
