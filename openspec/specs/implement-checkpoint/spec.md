# implement-checkpoint Specification

## Purpose
TBD - created by archiving change phase-3-implementation-pipeline. Update Purpose after archive.
## Requirements
### Requirement: The `ImplementCheckpoint` schema is the frozen cross-proposal interface

The schema MUST live in `@dusk/core-schema` (so Phase 4's Author package imports it without inverting the dep graph) and carry exactly the RFC §10.1.1 field set: `{ schema_version: 1, original_request, scope_hint?, decomposer_partial_state, intents_resolved_so_far[], intents_still_unresolved[], suggested_dialog_seed, unresolved_refs[], created_at, last_touched_at }`. Phase 3 SHALL ship `suggested_dialog_seed` as the naive `unresolved_refs.join(", ")` (typed-correct, content-naive); Phase 4 SHALL be able to enrich its *content* without changing its *shape*. (RFC §10.1.1; design D4.)

#### Scenario: Checkpoint shape matches the §10.1.1 field set

- **WHEN** an unresolved-intent escalation writes a checkpoint
- **THEN** the JSON parses against the `ImplementCheckpoint` Zod schema in `@dusk/core-schema`
- **AND** all required fields are populated with non-empty values
- **AND** `suggested_dialog_seed` equals the raw join of `unresolved_refs`

### Requirement: Checkpoint files live at the documented path with `rt_…` resume tokens

`packages/runtime/implement-checkpoint` SHALL write each checkpoint to `.ia/runtime/implement/<resume_token>.json` where `resume_token` follows the format `rt_<14-digit-yyyymmddhhmmss><3-digit-seq>` (the App. D.8 convention). The directory SHALL be created if missing. (RFC §10.1.1, App. D.8.)

#### Scenario: Checkpoint is written at the documented path

- **WHEN** an unresolved-intent escalation fires
- **THEN** a file exists at `.ia/runtime/implement/<resume_token>.json`
- **AND** `<resume_token>` matches `^rt_[0-9]{14}[0-9]{3}$`

### Requirement: `dusk_implement({resume_token})` continues the paused run and consumes the checkpoint

`dusk_implement` SHALL accept a `resume_token` parameter that resumes a paused run. The Decomposer SHALL reload partial state from the checkpoint, re-run the unresolved-ref check (which should now resolve if the intent has been authored), and proceed to Step 2. The checkpoint file SHALL be deleted as the pipeline transitions out of Step 1 (single-use). (RFC §10.1.1; **P3-T6**.)

#### Scenario: Resume completes and deletes the checkpoint

- **WHEN** an `implement_paused_for_authoring` checkpoint exists, the missing intent is authored out-of-band, and `dusk_implement({resume_token})` is called
- **THEN** the Decomposer re-runs the unresolved-ref check and proceeds to Step 2
- **AND** the checkpoint file is deleted before any Step-2 work begins
- **AND** a second `dusk_implement({resume_token})` with the same token returns `DuskError { kind: "implement_resume_token_expired" }` (single-use)

### Requirement: Expired checkpoints return an actionable error preserving the original request

Checkpoints SHALL have a 24h TTL since `last_touched_at` (read from the injected `Clock`). `dusk_implement({resume_token})` against a token whose checkpoint has aged past 24h SHALL return `DuskError { kind: "implement_resume_token_expired", recoverable: false }` whose `recovery_hint` quotes the original request so the user can re-issue it. (RFC §10.1.1; **P3-T7**.)

#### Scenario: Expired token returns an actionable error

- **WHEN** a checkpoint's `last_touched_at` is more than 24h before the injected Clock's `now()`, and `dusk_implement({resume_token})` is called
- **THEN** the call returns `DuskError { kind: "implement_resume_token_expired", recoverable: false }`
- **AND** the `recovery_hint` string contains the `original_request` from the checkpoint

### Requirement: `dusk doctor --gc-implement-checkpoints` reaps stale checkpoints

The CLI SHALL provide `dusk doctor --gc-implement-checkpoints` which deletes every `.ia/runtime/implement/<resume_token>.json` whose `last_touched_at` is more than 24h before `Clock.now()`. The command SHALL print one line per reaped token and exit 0 even when nothing was reaped (idempotent). (RFC §10.1.1.)

#### Scenario: Stale checkpoints are reaped; fresh ones are preserved

- **WHEN** the repo contains two checkpoints — one with `last_touched_at` 30h old, one with `last_touched_at` 1h old — and `dusk doctor --gc-implement-checkpoints` runs
- **THEN** the 30h-old checkpoint file is deleted
- **AND** the 1h-old checkpoint file is preserved
- **AND** the command exits 0

