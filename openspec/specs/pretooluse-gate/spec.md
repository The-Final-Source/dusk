# pretooluse-gate Specification

## Purpose
TBD - created by archiving change phase-1-substrate. Update Purpose after archive.
## Requirements
### Requirement: PreToolUse hook wire format and fail-safe

`packages/delivery/pre-tool-use` SHALL implement the PreToolUse hook handler per RFC §4.6.1, App. A.10: read stdin JSON `{tool, args, session_id, transcript_path}`, write stdout `{decision: "approve"}` or `{decision: "block", reason, structured_rejection}`, and exit 0 in both cases. Process-level failures MUST fail safe as a `block` carrying `structured_rejection.kind: "hook_internal_error"` — never a silent approve. (Plan P1-T9, P1-T12.)

#### Scenario: Clean decorated write is approved

- **WHEN** a fully and correctly decorated Write payload is piped to the installed hook binary over stdin
- **THEN** stdout is `{decision: "approve"}` and the process exits 0

#### Scenario: Internal error fails safe

- **WHEN** the handler receives structurally invalid stdin (e.g. truncated JSON)
- **THEN** it exits 0 with a `block` carrying `structured_rejection.kind: "hook_internal_error"`, never `approve`

### Requirement: Ten mechanical checks emit twelve typed rejection kinds

The gate SHALL run 10 mechanical checks (no LLM, no semantic analysis) that emit the 12 typed `Rejection` kinds of RFC App. A.8, with each block carrying a `file:line`. The agentic decorate-or-decompose (`S ⊆ D`) mandate is intentionally NOT a gate check. (Plan P1-T10, P1-T18.)

#### Scenario: Every rejection kind fires on its violation

- **WHEN** one fixture per App. A.8 rejection kind is piped through the hook (missing_decorator, missing_statement_decorator, unresolved_intent_path, unresolved_aspect_id, multiple_intents_on_one_line, missing_ignore_because, missing_ignore_reason, invalid_ignore_predicate, missing_support_triple, malformed_support_triple, focal_and_support_for_same_intent, non_test_path_on_intent_test)
- **THEN** each returns `{decision: "block"}` with the exact matching `structured_rejection.kind` and a `file:line`

#### Scenario: @intent-ignore vocabulary is enforced

- **WHEN** an `@intent-ignore` uses an out-of-vocabulary predicate, or omits `reason`
- **THEN** the gate blocks with `invalid_ignore_predicate` or `missing_ignore_reason` respectively

### Requirement: Check 10 blocks matrix-predicate negation in support triples

The gate SHALL reject any `@intent-support` whose inline triple `predicate` slot contains matrix-predicate negation (the RFC §3.1.1 lexicon), directing the author to use `polarity: negative` instead. (Plan P1-T11.)

#### Scenario: Negated support predicate is blocked

- **WHEN** a Write carries an `@intent-support` triple with the predicate "does not deliver"
- **THEN** the gate blocks with the negation rejection and a hint toward the polarity-decision guidance
- **AND** the affirmative form of the same triple is approved

### Requirement: Gate warns on writes referencing a superseded intent

When an intent B declares `relates_to: [{kind: supersedes, target: A}]`, the gate SHALL surface a non-blocking warning (not a `block`) on a write decorated `@intent A`, naming A as superseded-by-B, per RFC §2.1. (Plan P1-T21.)

#### Scenario: Superseded-path reference warns without blocking

- **WHEN** a Write decorated `@intent A` is gated and A is superseded by B
- **THEN** the gate surfaces a warning naming A as superseded-by-B and does not block the write

### Requirement: The gate validates per-file sidecars and enforces coverage on comment-less files

The PreToolUse gate (and the headless `gateWorktreeEdits`) SHALL recognize `<stem>.intent` per-file sidecars (already gated via the `.intent` extension) and enforce them with new mechanical, zero-model checks: the sidecar parses as valid JSON of the expected shape (`malformed_sidecar`); its `target` field equals its stem and the target exists (`sidecar_target_missing`); every claim/ignore anchor resolves against the live target (`unresolved_anchor`); no two claims resolve to overlapping spans (`overlapping_anchors`); and — in the post-hoc pair-state pass — every non-trivial line of a non-ignored target is covered (`uncovered_target_lines`). Per-claim intent paths and aspect ids reuse the existing `unresolved_intent_path`/`unresolved_aspect_id` checks; ignore entries reuse the existing `@intent-ignore` because/reason vocabulary. The gate SHALL consult the `decoration.ignore` glob set and skip ignored files. (RFC App. D.28; design D4/D5/D7.)

#### Scenario: A new rejection kind fires on an uncovered comment-less line

- **WHEN** the post-hoc worktree gate finds a non-ignored target with an uncovered non-trivial line
- **THEN** it blocks with `uncovered_target_lines` reporting the target file and line

#### Scenario: A dangling sidecar anchor is rejected

- **WHEN** a sidecar claim's JSON Pointer does not resolve against the live target
- **THEN** the gate blocks with `unresolved_anchor` naming the sidecar and pointer

#### Scenario: An ignored file is not gated for coverage

- **WHEN** a write touches a file matched by a `decoration.ignore` glob
- **THEN** the gate applies no sidecar/coverage check to it

### Requirement: A focal claimant of a test-suffix intent must be a test marker (reverse of Check 9)

The PreToolUse gate (and the headless `gateWorktreeEdits`) SHALL add the reverse of Check 9: a decoration record whose marker is a **focal non-test marker** (`intent` or `intent-file`) and whose `intent_path` ends in a configured `test_pyramid.suffixes` value SHALL be rejected with kind `non_test_marker_on_test_intent`, and a message directing the author to use `@intent-test-file <path>` (file scope) or `@intent-test` (declaration scope). This enforces, at write time, the invariant that a test-suffix intent's focal claimant is a test marker — so the body the Stage-1 pre-pass needs is reliably present. The forward Check 9 (a `intent-test`/`intent-test-file` marker's path must end in a configured suffix → `non_test_path_on_intent_test`) is unchanged; together they enforce *test-suffix intent ⟺ test-marker claimant present*. (RFC App. D.32, §4.6, App. A.8; design D4.)

#### Scenario: `@intent` claiming a test-suffix intent is rejected

- **WHEN** a write decorates a line with `// @intent app/x/unit-tests [covers-…]` (a focal non-test marker whose path ends in a configured test suffix)
- **THEN** the gate rejects with `non_test_marker_on_test_intent` naming the intent path
- **AND** the message directs the author to `@intent-test`/`@intent-test-file`

#### Scenario: Legitimate non-test decoration in a test file is NOT rejected

- **WHEN** a test file carries `@intent-support` lines, OR an `@intent` claiming a NON-test intent (a path that does not end in a configured suffix)
- **THEN** neither is rejected by this check (it fires only on a focal `intent`/`intent-file` whose `intent_path` IS a test-suffix intent)

#### Scenario: The correct test marker passes the gate

- **WHEN** a test file is decorated with `// @intent-test-file app/x/unit-tests`
- **THEN** the reverse check does not fire (the marker is a test marker)
- **AND** forward Check 9 confirms the path ends in a configured suffix

