## ADDED Requirements

### Requirement: The CLI exposes `dusk author` as a direct-invocation mirror of the MCP author surface

The `dusk` CLI SHALL gain `dusk author <request>` (mirrors `dusk_author_start`), `dusk author --continue <dialog_id> <response>` (mirrors `dusk_author_continue`), and `dusk author --finalize <dialog_id>` (mirrors `dusk_author_finalize`). These commands SHALL print responses in a human-readable form, propagate exit codes (0 success / non-zero on `DuskError`), and support `--help`. (RFC §10.2; Phase 4 CLI surface.)

#### Scenario: `dusk author <request>` opens a dialog and prints the first question

- **WHEN** `dusk author "add cursor encoding for paginated lists"` is invoked
- **THEN** the command creates a new dialog (mirrors `dusk_author_start`)
- **AND** prints the `dialog_id` plus the Stage 1 framing question
- **AND** exits 0

#### Scenario: `dusk author --continue` advances the dialog and prints the next question

- **WHEN** `dusk author --continue dlg_... "<response>"` is invoked
- **THEN** the command advances the dialog one turn (mirrors `dusk_author_continue`)
- **AND** prints the next question (or `finalize_ready`)
- **AND** exits 0

#### Scenario: `dusk author --finalize` prints the created intent paths

- **WHEN** `dusk author --finalize dlg_...` is invoked on a finalize-ready dialog
- **THEN** the command prints the list of created intent paths and exits 0

#### Scenario: `dusk author --continue` against an unknown dialog returns a typed error and non-zero exit

- **WHEN** `dusk author --continue dlg_nonexistent "<response>"` is invoked
- **THEN** the command prints `DuskError { kind: "author_dialog_id_unknown" }` in a readable form
- **AND** exits non-zero

#### Scenario: Every new author command supports `--help`

- **WHEN** `dusk author --help` is invoked (and likewise for `--continue --help`, `--finalize --help`)
- **THEN** the command prints a usage description with at least one example invocation
- **AND** exits 0
