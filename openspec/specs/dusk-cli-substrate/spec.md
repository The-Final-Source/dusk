# dusk-cli-substrate Specification

## Purpose
TBD - created by archiving change phase-1-substrate. Update Purpose after archive.
## Requirements
### Requirement: `dusk init` installs the gate idempotently and never clobbers

`dusk init` SHALL scaffold `dusk.config.yml`, the `.ia/*` directories, role-file stubs, and install the PreToolUse gate into `.claude/settings.json` with `_dusk_marker: "dusk-pre-tool-use-gate"` plus `_dusk_managed` as the idempotency anchor (re-runs match by marker, not by array position or content equality). On conflict with an existing non-Dusk Write/Edit PreToolUse entry it MUST present a three-option prompt (append / replace-with-backup / abort) and MUST never silently clobber, per RFC §4.6.1. (Plan P1-T13, P1-T14.)

#### Scenario: Re-running init is idempotent by marker

- **WHEN** `dusk init` is run twice in a repo
- **THEN** `.claude/settings.json` contains exactly one entry matched by `_dusk_marker`, regardless of surrounding entries being reordered

#### Scenario: Existing hook triggers the three-option prompt

- **WHEN** a foreign Write/Edit PreToolUse hook exists and `dusk init` runs
- **THEN** choosing append keeps both entries (foreign first), choosing replace writes `.claude/settings.json.bak` and records the replaced command, and choosing abort exits non-zero leaving settings unchanged

### Requirement: `dusk doctor --check-hook [--repair]` verifies installation

`dusk doctor --check-hook` SHALL exit 0 (all checks pass), 2 (configuration issue — settings missing, marker missing, path unresolvable), or 3 (round-trip failure — handler installed but malfunctioning). `--repair` SHALL re-run the merge logic for configuration issues only and MUST NOT auto-fix round-trip (exit-3) failures, per RFC §4.6.1. (Plan P1-T15.)

#### Scenario: Exit codes and scoped repair

- **WHEN** `--check-hook` runs against a correct install, a missing-marker install, and a broken handler that fails the synthetic round-trip
- **THEN** it returns 0, 2, and 3 respectively
- **AND** `--repair` fixes the exit-2 case but does not auto-fix the exit-3 case

### Requirement: `dusk validate` reports defects with file:line precision

`dusk validate` SHALL validate one or all intents against the schema and report each defect with its `file:line`, exiting non-zero on any defect and 0 when clean. (Plan P1-T19.)

#### Scenario: Malformed intents are located precisely

- **WHEN** an intent missing `obligation` and a triple missing `predicate` are validated
- **THEN** `dusk validate` exits non-zero naming each defect with its `file:line`, and exits 0 once both are fixed

### Requirement: `dusk inspect` shows intents and decoration claims

`dusk inspect` SHALL pretty-print an intent (description, triples, obligation, typed `relates_to`, descendants) and a file's decoration claims, including a hierarchical-satisfaction view that names unsatisfied children. (Plan P1-T19 family; RFC §10.2.)

#### Scenario: Inspect shows hierarchical relationships

- **WHEN** `dusk inspect <intent-path>` is run for an intent with test-pyramid children and no test code yet
- **THEN** it shows the intent's triples, obligation, and typed `relates_to`, plus a satisfaction view listing the unsatisfied test-pyramid child

### Requirement: The `dusk` CLI exposes the read-path commands that mirror the MCP read surface

The `dusk` CLI SHALL gain four new commands — `dusk verify`, `dusk inspect`, `dusk roles`, `dusk skills` — alongside the Phase-1 commands (`init`, `validate`, `inspect` for raw decoration listing, `doctor --check-hook`). The new commands SHALL be thin wrappers over the §mcp-read-surface tools / runtime queries — `dusk verify` calls the Verifier procedure read-only; `dusk inspect` issues the same query as the MCP `dusk_inspect` (and supersedes/extends the Phase-1 inspect surface to include hierarchical satisfaction, low-confidence supports, and test-intents); `dusk roles` and `dusk skills` introspect the installed `.claude/agents/dusk-*.md` role files and their declared skills. Every new command SHALL support `--help`. (RFC §10.1, §10.2; Phase-1 cli substrate extended.)

#### Scenario: `dusk verify` runs the Verifier procedure read-only

- **WHEN** `dusk verify <path>` is invoked against the App. B fixture
- **THEN** the command prints the per-triple verdicts in a human-readable form
- **AND** the working tree is unchanged and no commit is produced

#### Scenario: `dusk inspect` reports hierarchical satisfaction and low-confidence supports

- **WHEN** `dusk inspect notifications/send` is invoked after a low-confidence verdict has been produced for that intent
- **THEN** the output reports the intent's own-triple satisfaction, the test-pyramid children satisfaction (unsatisfied if test code is absent), and the low-confidence supports

#### Scenario: `dusk roles` lists the nine installed role files with their declared scopes

- **WHEN** `dusk roles` is invoked
- **THEN** the output enumerates `dusk-{root,bead,decomposer,scout,engineer,verifier,test-runner,author,conflict-resolver}` with each role's declared `memory`, `model`, and skill count

#### Scenario: `dusk skills` introspects the installed role-bound skills

- **WHEN** `dusk skills` is invoked
- **THEN** the output enumerates skills grouped by role, matching the layout under `.claude/skills/dusk/<role>/`

#### Scenario: Every new command supports --help

- **WHEN** `dusk verify --help`, `dusk inspect --help`, `dusk roles --help`, `dusk skills --help` are invoked
- **THEN** each prints a usage description, a flag list, and at least one example invocation

### Requirement: The `dusk` CLI exposes the Phase-3 write-path commands that mirror the MCP write surface

The `dusk` CLI SHALL gain the following commands alongside the Phase-1 + Phase-2 surface: `dusk implement` (mirrors `dusk_implement` for direct human invocation, primarily for debugging), `dusk implement --resume <bead-id>` (mirrors the resume side of `dusk_implement({resume_token})` and also serves as the resume path for L3-frozen beads per §recovery-ladder), `dusk doctor --cleanup-worktrees` (orphan-worktree reaping per §worktree-orchestration), `dusk doctor --gc-implement-checkpoints` (stale-checkpoint reaping per §implement-checkpoint), and `dusk doctor --gc-dialogs` (stale-dialog reaping). Every new command SHALL support `--help`. (RFC §10.2; Phase-3 CLI surface.)

#### Scenario: `dusk implement <request>` mirrors `dusk_implement`

- **WHEN** `dusk implement "add cursor decoding for paginated lists"` is invoked
- **THEN** the command runs the same 9-step pipeline as the MCP `dusk_implement` tool against the same repo
- **AND** the command prints the Step-9 summary in a human-readable form on success
- **AND** the working tree reflects the produced commits on the bead branches (or `main` after Step 8 completes)

#### Scenario: `dusk implement --resume <bead-id>` resumes an L3-frozen bead

- **WHEN** a bead is L3-frozen (a `freeze-state.md` exists under `.ia/runtime/beads/<bead-id>/`) and `dusk implement --resume <bead-id>` is invoked
- **THEN** the command reloads the frozen state and resumes the bead's Step-4 entry per §recovery-ladder
- **AND** prints the Step-9 summary (or any subsequent error) on completion

#### Scenario: `dusk doctor --cleanup-worktrees` is idempotent

- **WHEN** `dusk doctor --cleanup-worktrees` is invoked twice in sequence on a repo where the first run reaped one orphan
- **THEN** the first run reaps the orphan, prints its path, and exits 0
- **AND** the second run prints no output and exits 0

#### Scenario: `dusk doctor --gc-implement-checkpoints` reaps stale, preserves fresh

- **WHEN** the repo contains one stale checkpoint (>24h since `last_touched_at`) and one fresh checkpoint (<1h), and `dusk doctor --gc-implement-checkpoints` is invoked
- **THEN** the stale checkpoint file is deleted
- **AND** the fresh checkpoint file is preserved
- **AND** the command exits 0

#### Scenario: `dusk doctor --gc-dialogs` reaps stale dialogs

- **WHEN** `.ia/runtime/dialogs/` contains a dialog directory older than 24h, and `dusk doctor --gc-dialogs` is invoked
- **THEN** the stale dialog directory is deleted
- **AND** fresh dialog directories are preserved
- **AND** the command exits 0

#### Scenario: Every new command supports --help

- **WHEN** `dusk implement --help`, `dusk doctor --cleanup-worktrees --help`, `dusk doctor --gc-implement-checkpoints --help`, `dusk doctor --gc-dialogs --help` are invoked
- **THEN** each prints a usage description, a flag list, and at least one example invocation, and exits 0

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
