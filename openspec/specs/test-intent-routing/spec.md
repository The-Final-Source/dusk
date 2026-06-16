# test-intent-routing Specification

## Purpose
Test-pyramid intents are routed to the two-stage test pre-pass by their **authored path suffix** (the single source of truth for test-identity); the `@intent-test`/`@intent-test-file` marker locates the test body; a routed test intent with no discoverable body fails loud (`test_intent_no_test_marker`), never silently; the Engineer is taught the test markers and signalled when a bead is a test bead. (RFC App. D.32; created by archiving change test-pyramid-routing.)

## Requirements

### Requirement: Test-pyramid intents are routed to the two-stage pre-pass by their authored path suffix

A test intent's identity SHALL be determined by its **authored path suffix** — whether the intent path ends in a configured `test_pyramid.suffixes` value (`unit-tests`/`integration-tests`/`e2e-tests`) — NOT by the presence of a `@intent-test`/`@intent-test-file` decoration marker. The verifier (`cli/src/implement.ts` `verifierFactory`) SHALL route a test-suffix intent to the Stage-1 test-body pre-pass; a test-suffix intent SHALL NEVER fall through to ordinary `verifyIntent`. The decision SHALL use a single shared predicate over `test_pyramid.suffixes`, the same one consumed by the orchestrator and `dusk_inspect`. (RFC App. D.32, §3.4; design D1, D7.)

#### Scenario: A test-suffix intent routes to the pre-pass regardless of its marker

- **WHEN** a `DerivedIndex` contains a test-suffix intent (path ends in a configured suffix) whose only claimant carries `marker: "intent"` (so `testDiscovery` is empty)
- **THEN** the verifier routes the intent to the Stage-1 test-body pre-pass
- **AND** it does NOT fall through to ordinary `verifyIntent`
- **AND** the `covers-*` triples are never judged from ordinary single-line claim evidence

#### Scenario: Routing source of truth is shared, not duplicated

- **WHEN** the CLI verifier, the orchestrator, and `dusk_inspect` each decide whether an intent is a test intent
- **THEN** all three use the same shared suffix predicate over `test_pyramid.suffixes` (no divergent per-consumer test-identity logic)

### Requirement: The decoration marker locates the test body; it is required and never derived from the suffix

The `@intent-test`/`@intent-test-file` marker SHALL remain the file→test-intent link that the Stage-1 pre-pass and the Test Runner use to discover *which file* is the test body (`testDiscovery`). The marker SHALL NOT be dropped, and test-identity SHALL NOT be derived to synthesize a marker — the suffix routes (identity), the marker locates (evidence); these are distinct and both required. A test-suffix intent's `covers-*` triples are judged only by the pre-pass and never enter the structural/semantic verification fork (that axis is orthogonal). (RFC App. D.32, §3.4; design D2, D6.)

#### Scenario: The body is found via the marker, not the suffix

- **WHEN** the pre-pass verifies a routed test intent
- **THEN** it discovers the test body file(s) via the `@intent-test`/`@intent-test-file` markers (`testDiscovery`), not by the intent's path or filesystem location

### Requirement: A routed test intent with no discoverable body fails loud and legibly

When a test-suffix intent is routed to the pre-pass (or the Test Runner) but has **no** test-marker claimant (`testDiscovery` empty, i.e. the body cannot be located), the system SHALL fail with a specific, recoverable signal — `test_intent_no_test_marker` naming the intent path and the expected markers — NOT a silent skip, NOT a silent pass, and NOT the generic "test does not verify its claims" rationale. The short cycle SHALL receive an actionable cause it can correct. (RFC App. D.32, §3.4; design D3; "no silent behavior".)

#### Scenario: Missing body surfaces the real cause

- **WHEN** a test-suffix intent routes to the pre-pass and `testDiscovery` returns empty
- **THEN** the verdict is a `test_intent_no_test_marker` failure naming the intent and the `@intent-test`/`@intent-test-file` markers
- **AND** the failure is recoverable (re-enters the short cycle), not a silent acceptance or a generic verdict

#### Scenario: The Test Runner path also fails loud on an empty body

- **WHEN** the orchestrator Test Runner resolves zero test files for a test-suffix intent (empty `testFilesFor`)
- **THEN** it raises the same explicit `test_intent_no_test_marker` signal **before** invoking Vitest — never flowing to `runVitest([])` and returning a silent green pass (zero files run, no triple judged)

### Requirement: The Engineer is taught the test markers and signalled when a bead is a test bead

`ENGINEER_FILE_INSTRUCTION` and a `dusk/engineer/*` skill SHALL state that a file implementing a test-suffix intent must claim that intent with `@intent-test-file <test-intent-path>` (file scope) or `@intent-test` (declaration scope), never `@intent`. When the Engineer's per-bead target intent path ends in a configured `test_pyramid.suffixes` value, the bead task SHALL carry an explicit signal that this is a test bead whose file body is the evidence the pre-pass judges. This guidance is a first-pass-success rate improver; the mechanical guards (routing, gate, fail-loud) are what guarantee correctness. (RFC App. D.32; design D5.)

#### Scenario: Engineer guidance names the test markers

- **WHEN** the Engineer's instruction and loaded skills are assembled for a test-pyramid bead
- **THEN** they name `@intent-test`/`@intent-test-file` and state that the test file claims the test intent with a test marker (not `@intent`)
- **AND** the per-bead task signals that the intent is a test intent

#### Scenario: The mechanical guards hold independently of the guidance

- **WHEN** the Engineer ignores the guidance and decorates a test-suffix intent's test file with `@intent` (or omits the test marker entirely)
- **THEN** correctness still holds with no reliance on the guidance: routing still sends the intent to the pre-pass (never ordinary verification), the gate still rejects the focal `@intent`-on-test-suffix claim, and a missing body still fails loud (`test_intent_no_test_marker`)
- **AND** the guidance is therefore a first-pass-success rate-improver, never the mechanism that guarantees correctness
