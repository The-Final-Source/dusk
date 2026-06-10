## MODIFIED Requirements

### Requirement: `dusk_resolve_livelock({verb: "modify_triple"})` opens a scoped Author dialog (NOT inline payload)

Phase 3 shipped `dusk_resolve_livelock({bead_id, verb: "modify_triple", payload: {edited_triple}})` as a deliberate placeholder — the user passed the rewritten triple inline. Phase 4 SHALL rewire the verb to a scoped Author continuation:

- The `payload` parameter SHALL be REMOVED from the MCP signature.
- A new `dialog_init?` parameter SHALL be ADDED that carries the failing-triple seed when relevant.
- Calling `dusk_resolve_livelock({bead_id, verb: "modify_triple"})` against an active `TestVerifierLivelockReport` SHALL invoke `dusk_author_start({entry_mode: "scoped_triple_edit", dialog_init: { failing_triple: report.failing_triple }})` and return the `dialog_id` so the harness can drive `dusk_author_continue` / `dusk_author_finalize` against it.
- On `dusk_author_finalize`, the edited triple SHALL be written back into the existing intent file in-place (NOT a new intent), and the paused bead SHALL resume at the previously-failing iteration with the refreshed intent visible to the next Verifier spawn.

(RFC §3.4.1; design D5, D9; Phase-3 `livelock-detection` modification.)

#### Scenario: `modify_triple` opens a scoped triple-edit dialog

- **WHEN** a bead is paused with a `TestVerifierLivelockReport` and `dusk_resolve_livelock({bead_id, verb: "modify_triple"})` is called
- **THEN** the call invokes `dusk_author_start({entry_mode: "scoped_triple_edit", dialog_init: { failing_triple: report.failing_triple }})`
- **AND** the response carries the new `dialog_id`
- **AND** `intents_drafted[]` in the new dialog contains the failing triple pre-loaded for editing

#### Scenario: Inline payload form is rejected post-Phase-4

- **WHEN** `dusk_resolve_livelock({bead_id, verb: "modify_triple", payload: {edited_triple}})` is called (the Phase-3 form)
- **THEN** the call returns `DuskError { kind: "config_invalid" }` naming the removed `payload` parameter
- **AND** points the caller at the new `dialog_init` flow

#### Scenario: Finalize writes the edited triple in-place and resumes the bead

- **WHEN** the user drives the scoped dialog through `dusk_author_finalize`
- **THEN** the edited triple is written back into the existing intent file at `.ia/intents/<test-intent-path>/intent.yaml` (in-place, replacing the failing triple)
- **AND** no new intent file is created
- **AND** the paused bead resumes at the previously-failing iteration with the refreshed intent

### Requirement: `accept_test_as_is` and `escalate` verbs continue per Phase 3 contract

The two other livelock-resolution verbs — `accept_test_as_is` (commit with `Verifier-bypassed-test-intent` trailer) and `escalate` (invoke L3 freeze) — SHALL continue to operate exactly as Phase 3 shipped. Phase 4 does NOT alter their semantics. (RFC §3.4.1; Phase 3 `livelock-detection` contract held for these two verbs.)

#### Scenario: `accept_test_as_is` works unchanged post-Phase-4

- **WHEN** `dusk_resolve_livelock({bead_id, verb: "accept_test_as_is"})` is called against an active livelock in a Phase-4-installed repo
- **THEN** the bead commits with the `Verifier-bypassed-test-intent` trailer per the Phase-3 contract

#### Scenario: `escalate` works unchanged post-Phase-4

- **WHEN** `dusk_resolve_livelock({bead_id, verb: "escalate"})` is called against an active livelock
- **THEN** a Phase-3 L3 freeze artifact is produced per the Phase-3 contract
