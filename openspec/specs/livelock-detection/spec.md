# livelock-detection Specification

## Purpose
TBD - created by archiving change phase-3-implementation-pipeline. Update Purpose after archive.
## Requirements
### Requirement: A three-condition detector fires the Test-Verifier livelock signal

`packages/runtime/livelock-detection` SHALL implement the Test-Verifier livelock detector per RFC §3.4.1. The detector SHALL fire when ALL three conditions hold for the same `(test_intent_path, triple_id)`: (1) rejected for **≥3 consecutive iterations** within Step 6's test-driven Step-4 re-entry path; (2) Verifier rationale **slot-focus concentration ≥80%** on a single slot (`subject` / `predicate` / `object`); (3) Engineer has tried **≥3 distinct structural approaches** from the `dusk/engineer/test-approach-taxonomy` controlled vocabulary. (RFC §3.4.1; **P3-T18**.)

#### Scenario: All three conditions firing emits the report

- **WHEN** the scripted-verdict Verifier double returns `reject` on `(notifications/send/unit-tests, covers-persist-first)` for 3 consecutive iters with slot-focus ≥80% on `predicate`, and the Engineer has attempted ≥3 distinct taxonomy approaches
- **THEN** a `TestVerifierLivelockReport` is emitted
- **AND** the bead is paused (no further Step-4 iterations)

### Requirement: `TestVerifierLivelockReport` shape is frozen per RFC §3.4.1

The report shape SHALL be: `{ bead_id, test_intent_path, failing_triple_id, failing_triple: {subject, predicate, object, polarity}, iterations_rejected, engineer_attempts: [{approach_label, test_excerpt, verifier_rejection_summary, triple_slot_focus}], verifier_persistent_rationale: {slot_focus_distribution, common_phrase, full_rationales[], confidence}, suggested_resolutions: [{verb, requires, ...}] }` defined in `@dusk/core-schema`. (RFC §3.4.1; design D14.)

#### Scenario: Report parses against the frozen schema

- **WHEN** a livelock detection fires
- **THEN** the emitted report parses against the `TestVerifierLivelockReport` Zod schema in `@dusk/core-schema` with all required fields populated

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

### Requirement: Livelock takes precedence over budget exhaustion when both fire on the same iteration

The Bead Orchestrator's tick SHALL evaluate the livelock detector BEFORE the budget-exhaustion check. When both fire on the same iteration, the livelock report SHALL be emitted (not the generic budget-exhaustion error). The user resolves via `dusk_resolve_livelock` before iteration would otherwise resume. (RFC §6.4.1, §3.4.1; design D7; **P3-T28**.)

#### Scenario: Livelock + exhaustion → livelock wins

- **WHEN** the scripted-verdict Verifier double is configured so the lifetime budget exhausts on the exact iteration livelock would fire (same `(test_intent, triple)` rejected ≥3 iters, slot-focus ≥80%, ≥3 taxonomy approaches)
- **THEN** the orchestrator emits a `TestVerifierLivelockReport`
- **AND** does NOT emit a recovery-ladder exhaustion error (`bead_intent_revision_needed` / `bead_frozen` / `bead_aborted`)
- **AND** the user's resolution via `dusk_resolve_livelock` is what governs the bead's next state

