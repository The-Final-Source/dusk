## ADDED Requirements

### Requirement: The App. B worked example is a standing CI-wired verify regression

`packages/fixtures/worked-example/` SHALL contain the RFC App. B `sendNotification` clean-decoration file plus its intents (including the negative-polarity triple and the `compose: implies` conditional intent the Phase-2 smoke used). A CI-wired test SHALL run `dusk verify` over the fixture and assert every focal verdict passes — the canonical decoration never silently rots. The test SHALL be part of the repo's standard test surface so every PR re-validates it (the real-model leg follows the correctness-gated convention; the fixture's parse/index/inspect validation runs on every PR unconditionally). (RFC App. B; roadmap Sprint 9; **P5-T10**.)

#### Scenario: The worked example verifies clean

- **WHEN** `dusk verify` runs over `packages/fixtures/worked-example/`
- **THEN** every focal verdict passes, including the negative-polarity triple and the `implies` intent's documented outcomes

#### Scenario: The regression is wired into the CI test surface

- **WHEN** the repo's test suite runs
- **THEN** the worked example's parse/index/inspect validation executes unconditionally
- **AND** the real-model verify leg executes under the correctness-gated env-var per the Phase 2–4 convention

#### Scenario: A decoration regression in the fixture fails the suite

- **WHEN** the fixture's decoration is deliberately broken (a focal claim removed)
- **THEN** the regression test fails naming the unsatisfied aspect
