## ADDED Requirements

### Requirement: Two-stage satisfaction excludes Verifier-rejected tests from Vitest invocation

`packages/runtime/test-runner` SHALL implement Step 6 of the 9-step pipeline per RFC §3.4. Before invoking Vitest, the Test Runner SHALL run a **Verifier pre-pass** on every test body annotated by an `@intent-test` decorator: the standard §3.3 Verifier procedure SHALL evaluate whether the test body verifies what its `@intent-test` claim asserts. Tests whose pre-pass returns `focal_verdict: fail` SHALL be excluded from the scoped file list passed to Vitest — they SHALL NOT run. The bead SHALL re-enter Step 4 to have the Engineer fix the rejected tests. (RFC §3.4; design D8; **P3-T16**.)

#### Scenario: Trivially-passing test is rejected pre-execution and never runs

- **WHEN** a test body `db.insert(...); pubsub.publish(...); expect(true).toBe(true)` is annotated `@intent-test covers-persist-first`
- **THEN** the Verifier pre-pass returns `focal_verdict: fail` for that test
- **AND** the Test Runner does NOT invoke Vitest on that test
- **AND** the bead re-enters Step 4 with the failing test-intent in scope

### Requirement: Verifier-validated tests run under real Vitest and roll up to a per-test-intent `TestVerdict`

For tests passing the Verifier pre-pass, the Test Runner SHALL spawn a real `pnpm vitest run <scoped-files> --reporter=json` subprocess from the workspace root, parse the JSON reporter output to capture per-test pass/fail/duration, and map each captured test back to its `(test_intent, triple_id)` via the file's `@intent-test-file` + per-test `@intent-test` decorators. The Test Runner SHALL compute a `TestVerdict` per test-intent per RFC App. A.5. A `covers-X` triple SHALL be satisfied iff ≥1 captured test mapped to that triple passes. (RFC §3.4, §6.6, App. A.5; design D8; **P3-T17**.)

#### Scenario: Verified passing tests produce satisfied TestVerdicts

- **WHEN** real passing unit tests for `notifications/send/unit-tests` pass the Verifier pre-pass and are passed to Vitest
- **THEN** the Test Runner invokes `pnpm vitest run <unit-test-files> --reporter=json` from the workspace root
- **AND** captures pass/duration per test from the JSON reporter
- **AND** emits a `TestVerdict` whose `covers-*` triples are all satisfied
- **AND** the `TestVerdict` is consumed by the pipeline to roll up the parent intent's satisfaction

### Requirement: `TestVerdict` shape is frozen per App. A.5

The `TestVerdict` shape SHALL be: `{ test_intent_path, decision: "pass" | "fail", per_triple: [{ triple_id, verdict: "pass" | "fail", mapped_tests: string[], rationale }], rationale, duration }` per RFC App. A.5, defined in `@dusk/core-schema`. The shape SHALL be the frozen cross-proposal interface that Phase 5's audit reads. (RFC App. A.5; design D14.)

#### Scenario: Every TestVerdict parses against the schema

- **WHEN** a Test Runner run completes
- **THEN** every emitted `TestVerdict` parses against the Zod schema in `@dusk/core-schema` with all required fields populated

### Requirement: Configurable test-pyramid suffix discovery routes to the right Vitest invocation

The Test Runner SHALL discover test files via the derived-index's `@intent-test-file` claims, filtered by the test-intent's suffix (`/unit-tests` / `/integration-tests` / `/e2e-tests` / any custom suffix configured in `dusk.config.yml > test_pyramid.suffixes` — the Phase-1 contract). Each suffix's tests SHALL be invoked in its own Vitest scope (separate subprocess if needed for different environments). (RFC §3.4; Phase-1 `derived-index` capability.)

#### Scenario: Custom test-pyramid suffix is discovered

- **WHEN** `dusk.config.yml > test_pyramid.suffixes` includes `contract-tests`, and an intent has a `<intent>/contract-tests` child with tests
- **THEN** the Test Runner discovers those tests via the index and invokes Vitest on them
