export type DecorationMarker =
  | "intent"
  | "intent-support"
  | "intent-test"
  | "intent-test-file"
  | "intent-file"
  | "intent-ignore";

export type DecorationScope = "declaration" | "statement" | "file" | "directory";

export type SupportTriple = [subject: string, predicate: string, object: string];

export type IgnoreClause = { because: [string, string, string]; reason: string };

/** One decoration occurrence (RFC §2.9 / App. A.2). */
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
};
