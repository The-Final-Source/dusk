# dialog-state Specification

## Purpose
TBD - created by archiving change phase-4-intent-authoring. Update Purpose after archive.
## Requirements
### Requirement: The `DialogState` schema is the frozen cross-proposal interface

The schema MUST live in `@dusk/core-schema` (so Phase 5's audit imports it without inverting the dep graph) and carry exactly: `{ schema_version: 1, dialog_id, request, current_stage: 1 | 2 | 3 | 4 | "4.5" | 5, transcript: TranscriptEntry[], intents_drafted: Intent[], created_at, last_touched_at }` where `TranscriptEntry = { role: "author" | "user", content, stage, at }`. The `intents_drafted[]` accumulates the in-progress draft and is only schema-validated at Stage 4.5; the `transcript[]` is the audit-reachable record of human-Author negotiation. (RFC §5, §10.1; design D2, D9.)

#### Scenario: DialogState shape parses against the Zod schema

- **WHEN** a dialog has been driven through several `dusk_author_continue` turns
- **THEN** the on-disk state parses against `DialogState` in `@dusk/core-schema`
- **AND** every required field is populated with non-empty values
- **AND** the `transcript[]` contains one entry per turn (both Author + user)

### Requirement: Dialog files live at the documented path with `dlg_…` ids

`packages/runtime/author` SHALL write each dialog's state to `.ia/runtime/dialogs/<dialog-id>/state.md` where `dialog_id` follows the format `dlg_<14-digit-yyyymmddhhmmss><3-digit-seq>` (Phase 1's App. D.8 convention, Clock-injected). The directory SHALL be created at `dusk_author_start` and destroyed at `dusk_author_finalize`. (RFC §10.1; design D2.)

#### Scenario: Dialog file is written at the documented path

- **WHEN** `dusk_author_start({request})` is called
- **THEN** a file exists at `.ia/runtime/dialogs/<dialog-id>/state.md`
- **AND** `<dialog-id>` matches `^dlg_[0-9]{14}[0-9]{3}$`
- **AND** the file's YAML frontmatter carries the documented field set

### Requirement: The disk format is YAML frontmatter + Markdown transcript with deterministic round-trip

The dialog state SHALL be persisted as YAML frontmatter (`dialog_id`, `request`, `current_stage`, `created_at`, `last_touched_at`) followed by Markdown sections per design D2: `## Intents drafted` (YAML-encoded list of partial Intents), `## Transcript` containing per-turn `## Turn N` sub-sections with role/stage headers and content. Parse-then-serialize SHALL be byte-identical. (Design D2.)

#### Scenario: A populated dialog round-trips byte-identically

- **WHEN** a dialog state file containing frontmatter + drafted intents + a multi-turn transcript is read and immediately written back through the typed API
- **THEN** the new file bytes equal the original bytes

#### Scenario: A new turn appends to the transcript without rewriting prior entries

- **WHEN** `dusk_author_continue` is called and a new turn is recorded
- **THEN** the previously-recorded `## Turn N` sub-sections retain their original byte content
- **AND** a new `## Turn N+1` sub-section is appended with the new role/stage/content

### Requirement: Dialog state is persisted on every transition (survives harness crashes)

Every successful `dusk_author_continue` call SHALL persist the updated `DialogState` to disk **before** returning the next-question payload. A `dusk_author_continue` against a previously-aborted call SHALL be able to read the state from the previous (successful) turn — survival across harness restarts is required. (Design D2; **P4-T13**.)

#### Scenario: Mid-dialog harness restart preserves state

- **WHEN** a dialog progresses to Stage 3 via three `dusk_author_continue` calls, and the harness process is restarted
- **THEN** a fresh `dusk_author_continue({dialog_id})` call reads `current_stage: 3` from disk
- **AND** the transcript contains the three previous turns

#### Scenario: Multi-turn state accumulates across continue calls

- **WHEN** three sequential `dusk_author_continue` calls each advance the dialog
- **THEN** each turn's read of `DialogState` sees the previous turns' decisions reflected in `intents_drafted[]` and `transcript[]`

### Requirement: Concurrent writes against the same dialog are serialized

The Author runtime SHALL take a per-`dialog_id` advisory file lock during state writes. Concurrent `dusk_author_continue` or `dusk_author_finalize` calls against the same `dialog_id` SHALL serialize; the loser of a race against a `finalize` (which destroys the dialog) SHALL return `DuskError { kind: "author_dialog_id_unknown" }`. (Design D10 risks; **P4-T9**.)

#### Scenario: Concurrent continue calls serialize without state corruption

- **WHEN** two `dusk_author_continue` calls against the same `dialog_id` arrive concurrently
- **THEN** they are processed sequentially
- **AND** the on-disk state after both reflects both turns in order

#### Scenario: Continue against a just-finalized dialog returns an unknown error

- **WHEN** a `finalize` and a `continue` race against the same `dialog_id`, and the `finalize` wins
- **THEN** the losing `continue` returns `DuskError { kind: "author_dialog_id_unknown" }`

### Requirement: Dialog directories survive 24h then GC

Dialog directories SHALL be reaped by the existing `dusk doctor --gc-dialogs` (shipped in Phase 3) when `last_touched_at` is more than 24h before the injected `Clock.now()`. The GC SHALL preserve directories younger than 24h. (RFC §5, §10.1.1; **P4-T10**.)

#### Scenario: Stale dialog is reaped; fresh one preserved

- **WHEN** the repo contains two dialogs — one with `last_touched_at` 30h old, one with `last_touched_at` 1h old — and `dusk doctor --gc-dialogs` is invoked
- **THEN** the 30h-old dialog directory is deleted
- **AND** the 1h-old dialog directory is preserved
