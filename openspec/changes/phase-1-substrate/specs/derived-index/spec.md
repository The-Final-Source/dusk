## ADDED Requirements

### Requirement: The derived index answers all decoration queries

`packages/core/index` SHALL build an in-memory index (rebuilt at session start; not an on-disk artifact) over decoration records and answer: forward (`intent_path → claimants`), reverse (`file → intents`), focal/support (`(intent_path, aspect_id) → (focal_claimants[], support_claimants[])`, where each support claimant carries its inline NL triple), aspect-rollup (`intent_path → unsatisfied aspect_ids`), and test-discovery (`intent_path → test decorators keyed by pyramid layer`), per RFC §2.9, §3.3. (Plan P1-T6.)

#### Scenario: Focal/support query returns scoped claimants

- **WHEN** the focal/support query is run for a single `(intent, aspect)` over a decorated file
- **THEN** it returns exactly that aspect's focal claimant(s) and support claimant(s) with their inline triples
- **AND** lines participating only in other aspects are excluded from the result

### Requirement: Hierarchical satisfaction rolls up through test children

The index SHALL report a parent intent satisfied only when its own triples pass AND every child — including `…/unit-tests`, `…/integration-tests`, `…/e2e-tests` when present — is satisfied, per RFC §1.3, §3.4. (Plan P1-T5.)

#### Scenario: Unsatisfied test child blocks parent satisfaction

- **WHEN** a parent's own triples pass but a test-pyramid child has an unsatisfied aspect
- **THEN** the parent is reported unsatisfied, naming the child as the cause
- **AND** satisfying the child flips the parent to satisfied

### Requirement: Test-pyramid suffixes are configurable end-to-end

The reserved suffixes SHALL be read from `dusk.config.yml > test_pyramid.suffixes`; a path ending in any configured suffix resolves as a test-pyramid child and is keyed under that layer in the test-discovery query, per RFC §3.4. (Plan P1-T17.)

#### Scenario: Added suffix resolves and is keyed by layer

- **WHEN** `contract-tests` is added to the configured suffixes and a `@intent-test X/contract-tests` decorator exists
- **THEN** the graph resolves it as a test child of `X` and the test-discovery query keys it under the new layer
