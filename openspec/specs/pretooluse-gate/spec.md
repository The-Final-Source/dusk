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

