## ADDED Requirements

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

### Requirement: `dusk_resolve_livelock` accepts three verbs and resumes the bead accordingly

The MCP server SHALL expose `dusk_resolve_livelock({bead_id, verb, payload?})` accepting three verbs per RFC §3.4.1:

- `accept_test_as_is` → the bead commits with a `Verifier-bypassed-test-intent: <test_intent_path>[<triple_id>]` trailer naming the failing triple; bead exits Step 4 to Step 5.
- `modify_triple` → in Phase 3, the call accepts an inline `payload: { edited_triple }` carrying the rewritten triple; Step 4 re-enters with the refreshed intent. (Phase 4 will rewire this to a `dusk_author_continue` flow once the dialog continuation pattern exists — design Q4 resolution.)
- `escalate` → invokes Level-3 freeze (`recovery-ladder`); a `freeze-state.md` artifact is produced and `DuskError { kind: "bead_frozen", recoverable: false }` is returned.

(RFC §3.4.1; design D14, Q4; **P3-T18**.)

#### Scenario: `accept_test_as_is` commits with the bypass trailer

- **WHEN** a `TestVerifierLivelockReport` is active and `dusk_resolve_livelock({bead_id, verb: "accept_test_as_is"})` is called
- **THEN** the bead commits with a `Verifier-bypassed-test-intent: <test_intent_path>[<triple_id>]` trailer naming the failing triple
- **AND** the bead exits Step 4 and proceeds to Step 5

#### Scenario: `modify_triple` re-enters Step 4 with the refreshed intent (Phase 3 inline-payload form)

- **WHEN** `dusk_resolve_livelock({bead_id, verb: "modify_triple", payload: {edited_triple}})` is called against an active livelock
- **THEN** the failing triple is refreshed in the intent (in-memory for the active run)
- **AND** the bead re-enters Step 4 from the previously-failing iteration
- **AND** the previously-failing iteration sees the refreshed intent in its Verifier spawn payload

#### Scenario: `escalate` invokes Level-3 freeze

- **WHEN** `dusk_resolve_livelock({bead_id, verb: "escalate"})` is called against an active livelock
- **THEN** a `.ia/runtime/beads/<bead-id>/freeze-state.md` artifact is produced (per `recovery-ladder`)
- **AND** the result is `DuskError { kind: "bead_frozen", recoverable: false }`

### Requirement: Livelock takes precedence over budget exhaustion when both fire on the same iteration

The Bead Orchestrator's tick SHALL evaluate the livelock detector BEFORE the budget-exhaustion check. When both fire on the same iteration, the livelock report SHALL be emitted (not the generic budget-exhaustion error). The user resolves via `dusk_resolve_livelock` before iteration would otherwise resume. (RFC §6.4.1, §3.4.1; design D7; **P3-T28**.)

#### Scenario: Livelock + exhaustion → livelock wins

- **WHEN** the scripted-verdict Verifier double is configured so the lifetime budget exhausts on the exact iteration livelock would fire (same `(test_intent, triple)` rejected ≥3 iters, slot-focus ≥80%, ≥3 taxonomy approaches)
- **THEN** the orchestrator emits a `TestVerifierLivelockReport`
- **AND** does NOT emit a recovery-ladder exhaustion error (`bead_intent_revision_needed` / `bead_frozen` / `bead_aborted`)
- **AND** the user's resolution via `dusk_resolve_livelock` is what governs the bead's next state
