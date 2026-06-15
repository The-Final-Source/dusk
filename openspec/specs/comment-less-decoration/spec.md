# comment-less-decoration Specification

## Purpose
TBD - created by archiving change universal-decoration-coverage. Update Purpose after archive.
## Requirements
### Requirement: Comment-less files are decorated via a per-file `<filename.ext>.intent` sidecar

A file whose format cannot carry inline comments (strict JSON such as `package.json`) SHALL be linked to intents by a colocated per-file sidecar named `<filename.ext>.intent` (e.g. `package.json.intent`). The sidecar SHALL be a third decoration parser whose output normalizes to the same `DecorationRecord[]` as inline decoration and the directory `.intent` — one model, not a parallel system. It reuses the already-gated `.intent` extension (no `isGatedFile` change). Dispatch is by basename: a file named exactly `.intent` is the directory-scope sidecar (unchanged); a file whose basename has a stem and ends `.intent` is a per-file sidecar whose `target` is the stem. (RFC App. D.28, Ch. 4.5.4; design D1/D2.)

#### Scenario: A per-file sidecar is recognized and targets its stem

- **WHEN** the scanner encounters `package.json.intent`
- **THEN** it is parsed as a per-file sidecar whose target is `package.json`
- **AND** its records carry the same `DecorationRecord` shape as inline/directory decoration

#### Scenario: The directory `.intent` is still directory-scope

- **WHEN** the scanner encounters a file named exactly `.intent`
- **THEN** it is parsed as the directory-scope sidecar (existing behavior), not a per-file sidecar

### Requirement: The sidecar stores structural JSON-Pointer anchors; line spans are derived, never stored

Each sidecar claim SHALL anchor to a target location by **JSON Pointer** (RFC 6901) — the stored source of truth — with `""` denoting the whole document. The sidecar SHALL NOT store line numbers, line ranges, content hashes, or source-map structures. Line spans SHALL be **derived every run** by parsing the target with a location-aware JSON parser (pointer → AST node → `[startLine, endLine]`). A pointer that no longer resolves against the live target SHALL be a hard `unresolved_anchor` finding, never a silent skip. The body shape: `{ schema_version, target, claims:[{ anchor, marker, intent_path, aspect_ids? }], ignore:[{ anchor, because, reason }] }`. (RFC App. D.28; design D3.)

#### Scenario: A pointer resolves to a current line span after the file is reformatted

- **WHEN** the target file is reformatted or its keys reordered, leaving a claimed key present
- **THEN** the claim's JSON Pointer still resolves and yields the key's current line span
- **AND** no stored line number is consulted

#### Scenario: A dangling pointer is a hard finding

- **WHEN** a claim's JSON Pointer no longer resolves against the live target (the key was removed/renamed)
- **THEN** the run reports a hard `unresolved_anchor` finding naming the sidecar and the pointer

### Requirement: The `DecorationRecord` shape carries the anchor and a verification class additively

`DecorationRecord` SHALL gain `anchor: string | null` (the JSON Pointer; `null` for inline/directory records), a `region` scope member, and a `verify: "structural" | "semantic"` discriminator (default `semantic`; sidecar records `structural`). The additions SHALL be additive with defaults so existing parsers and records are unchanged. The `region` scope member SHALL be **wired, not speculative**: the per-file sidecar parser emits `scope: "region"` for a per-key claim (a non-root JSON Pointer) and `scope: "file"` for a whole-file claim (root pointer `""`, marker `intent-file`). (Design D8.)

#### Scenario: Existing inline records are unaffected

- **WHEN** an inline `// @intent` record is produced after the schema change
- **THEN** it has `anchor: null` and `verify: "semantic"` and behaves exactly as before

#### Scenario: Sidecar claims carry the right scope

- **WHEN** the sidecar parser emits a record for a per-key claim (non-root pointer) and for a whole-file claim (root pointer `""`)
- **THEN** the per-key record has `scope: "region"` and the whole-file record has `scope: "file"`

