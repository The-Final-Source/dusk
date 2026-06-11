# author-mcp-surface Specification

## Purpose
TBD - created by archiving change phase-4-intent-authoring. Update Purpose after archive.
## Requirements
### Requirement: `dusk_author_start({request})` opens a new dialog and returns the first question

The MCP server SHALL expose `dusk_author_start({ request: string, entry_mode?: AuthorEntryMode })` returning `{ dialog_id, stage: 1, next_question }` per RFC §10.1. The default `entry_mode` is `"full"` (Stages 1 → 5). `"scoped_triple_edit"` (used by `livelock-detection`'s `modify_triple` resolution) skips Stages 1–3 and starts at Stage 4 with the failing triple pre-loaded. `"l2_recovery"` (used by `recovery-ladder`'s L2 recovery action) takes a proposal file path and starts at Stage 3 with the proposal injected. The call SHALL create the dialog directory at `.ia/runtime/dialogs/<dialog-id>/`. (RFC §10.1; design D1, D5, D6.)

#### Scenario: Fresh request opens at Stage 1

- **WHEN** `dusk_author_start({request: "add cursor encoding for paginated lists"})` is called
- **THEN** the response contains `{dialog_id: "dlg_...", stage: 1, next_question: "..."}`
- **AND** `.ia/runtime/dialogs/<dialog-id>/state.md` exists

#### Scenario: Scoped triple edit opens at Stage 4 with the failing triple pre-loaded

- **WHEN** `dusk_author_start({request, entry_mode: "scoped_triple_edit", dialog_init: {failing_triple}})` is called from a livelock resolution
- **THEN** the response contains `{dialog_id, stage: 4, next_question}` framing the triple to edit
- **AND** `intents_drafted[]` contains a single intent with the failing triple pre-loaded for revision

#### Scenario: L2 recovery opens at Stage 3 with the proposal injected as the practice proposal

- **WHEN** `dusk_author_start({request, entry_mode: "l2_recovery", dialog_init: {proposal_path}})` is called against an L2-frozen bead
- **THEN** the response contains `{dialog_id, stage: 3, next_question}` framing the proposal for the user
- **AND** the proposal's rephrasings are presented as the Stage-3 practice proposal

### Requirement: `dusk_author_continue({dialog_id, response, payload?})` advances the dialog one turn

The MCP server SHALL expose `dusk_author_continue({ dialog_id: string, response: string, payload?: object })` that loads the existing `DialogState`, runs one transition per §author-five-stage-flow, persists the new state, and returns either `{ stage, next_question }` (more turns required) or `{ finalize_ready: true }` (Stage 5 reached and validated). The `payload?` field carries optional typed data for structured user choices (e.g., a list of pyramid layer ids) and ALWAYS takes precedence over free-text derivation; when no structured pick is supplied the deterministic free-text contract in `dusk-cli-substrate` ("Free-text pyramid picks are derived deterministically") applies. (RFC §10.1; design D1.)

#### Scenario: Continue advances Stage 1 → Stage 2 on framing confirmation

- **WHEN** a dialog is at Stage 1 with a framing question, and `dusk_author_continue({dialog_id, response: "<confirmation>"})` is called
- **THEN** the response contains `{stage: 2, next_question: "..."}` for Stage 2's discovery
- **AND** the persisted `DialogState.current_stage` is `2`

#### Scenario: Continue loops back to Stage 1 on framing rejection (P4-T11 surface)

- **WHEN** a dialog is at Stage 1 with a framing question, and the user's response rejects the framing
- **THEN** the response contains `{stage: 1, next_question: "..."}` (a regenerated framing)
- **AND** the persisted `DialogState.current_stage` remains `1`

#### Scenario: Continue surfaces finalize_ready when Stage 5 is reached

- **WHEN** Stage 4 + 4.5 produce valid drafts and the dialog reaches Stage 5
- **THEN** the next `dusk_author_continue` response contains `{ finalize_ready: true }`
- **AND** the dialog is preserved (not destroyed) until `dusk_author_finalize` is called

### Requirement: `dusk_author_finalize({dialog_id})` atomically commits the drafted intents and destroys the dialog

The MCP server SHALL expose `dusk_author_finalize({ dialog_id: string })` returning `{ intents_created: string[] }` (a list of created intent paths). Finalize SHALL atomically write every `intents_drafted[]` entry per §author-five-stage-flow's atomic-commit requirement. On success, the dialog directory SHALL be removed. On partial-write failure, the dialog SHALL be preserved and `DuskError { kind: "author_finalize_partial_failure", recoverable: true }` SHALL be returned. (RFC §5 Stage 5; design D8.)

#### Scenario: Finalize succeeds and returns the created intent paths

- **WHEN** a multi-intent dialog at Stage 5 is finalized and all writes succeed
- **THEN** the response is `{ intents_created: ["api/...", "api/.../unit-tests", ...] }` listing every created intent path
- **AND** the dialog directory is removed

#### Scenario: Finalize against a non-finalize-ready dialog returns a typed error

- **WHEN** `dusk_author_finalize({dialog_id})` is called on a dialog still at Stage 2
- **THEN** the response is `DuskError { kind: "author_stage_invalid_response", recoverable: true }` naming the current stage and what's needed to reach finalize-ready

### Requirement: Bad dialog ids return typed errors, not throws

The MCP server SHALL translate dialog-id failures into typed `DuskError`s — `author_dialog_id_unknown` (no such dialog), `author_stage_invalid_response` (response shape doesn't match the current stage's expectations), `author_intent_schema_invalid` (the drafted intent failed Stage 4.5 — should not propagate to finalize but if it does, it surfaces here), `author_finalize_partial_failure` (rollback), `author_l2_proposal_unreadable` (L2 entry with a malformed proposal file). No exception SHALL escape the MCP boundary. (RFC §10.1, App. A.11; design D9; **P4-T9**.)

#### Scenario: Unknown dialog id returns typed error

- **WHEN** `dusk_author_continue({dialog_id: "dlg_nonexistent"})` is called
- **THEN** the response is `DuskError { kind: "author_dialog_id_unknown", recoverable: true }`
- **AND** the `recovery_hint` suggests calling `dusk_author_start` to begin a fresh dialog

#### Scenario: Invalid stage response returns typed error

- **WHEN** a dialog is at Stage 4 expecting a structured draft confirmation, and the response is malformed
- **THEN** the response is `DuskError { kind: "author_stage_invalid_response", recoverable: true }`
- **AND** the persisted dialog is preserved at the same stage (the user can retry)

### Requirement: `/dusk-author` slash command is a thin wrapper around the three MCP tools

The MCP server SHALL expose `/dusk-author <request>` (calls `dusk_author_start`), `/dusk-author --continue <dialog_id> <response>` (calls `dusk_author_continue`), and `/dusk-author --finalize <dialog_id>` (calls `dusk_author_finalize`). The slash command SHALL print the response in a human-readable form and exit 0 on success. (RFC §10.2; design Q4.)

#### Scenario: `/dusk-author <request>` prints the first question

- **WHEN** `/dusk-author "add cursor encoding for paginated lists"` is invoked
- **THEN** the command prints the `dialog_id` + the Stage 1 framing question in a readable form
- **AND** exits 0

#### Scenario: `/dusk-author --continue <dialog_id> <response>` advances the dialog and prints the next question

- **WHEN** `/dusk-author --continue dlg_... "yes that framing is correct"` is invoked
- **THEN** the command prints the next question (or `finalize_ready`) and exits 0

#### Scenario: `/dusk-author --finalize <dialog_id>` prints the created intent paths

- **WHEN** `/dusk-author --finalize dlg_...` is invoked on a finalize-ready dialog
- **THEN** the command prints the list of created intent paths and exits 0
