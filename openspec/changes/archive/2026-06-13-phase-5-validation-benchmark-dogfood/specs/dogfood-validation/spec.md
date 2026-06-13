## ADDED Requirements

### Requirement: Dusk operates on a real package with hard go/no-go thresholds

The dogfood SHALL run against `packages/shared` (the pure-leaf production package): author intents via the real `dusk_author_*` flow, decorate the existing code under the PreToolUse gate, run `dusk_implement` for a small real feature request, and run `/dusk-doctor` periodically over a window of **≥14 calendar days from the first decorated commit**. The gate is **hard go/no-go thresholds**, not "data was collected":

- `e2e_implement_success_count ≥ 1` — at least one end-to-end `dusk_implement` producing a mergeable commit with full v9 trailers.
- `gate_false_positive_count == 0` on the decorated package (the gate never rejected a legitimate write).
- `worked_example_regression == clean` throughout the window.
- `package_test_suite == green` — `packages/shared`'s own tests pass after every Dusk-produced change.

(Roadmap Sprint 10; RFC §8.2; design D8; **P5-T11**.)

#### Scenario: A real feature lands through the full pipeline

- **WHEN** `dusk_implement` runs for a small real feature request against the decorated `packages/shared`
- **THEN** a commit lands with the full v9 trailer set
- **AND** `packages/shared`'s existing test suite stays green
- **AND** one full trace stream is captured with all v9 fields populated

#### Scenario: The go/no-go evaluation is deterministic and re-runnable

- **WHEN** `dusk benchmark --evaluate-dogfood` runs over the collected window data
- **THEN** it emits a `DogfoodReport` whose gating section evaluates the four named thresholds with explicit pass/fail per threshold
- **AND** re-running it over the same data produces an identical report

### Requirement: Exploratory metrics are recorded as explicitly non-gating

Operational metrics with no pre-set bar — iteration-count distributions, Author branching distributions, stuckness-fire rates, doctor finding trends, adoption-friction notes — SHALL be collected into `.ia/observability/dogfood/` as dated JSONL and reported in the `DogfoodReport`'s **exploratory section, labeled non-gating in the artifact itself**. The plan is honest about which numbers block v1 (the four thresholds) and which merely inform v1.x. (Design D8; the no-blended-metrics rule; **P5-T11**.)

#### Scenario: The report separates gates from exploration structurally

- **WHEN** the `DogfoodReport` is emitted
- **THEN** the gating section contains exactly the four named thresholds with pass/fail values
- **AND** the exploratory section is present, labeled `gating: false`, and carries the distribution metrics
- **AND** no exploratory metric appears in the gating section

### Requirement: Friction feedback flows into role prompts and skills as ordinary commits

Adoption-friction observations collected during the window SHALL feed back into the versioned role files (`.claude/agents/dusk-*.md`) and skills (`.claude/skills/dusk/**`) as ordinary reviewed commits during the window — the feedback loop is the normal git workflow, not a separate mechanism. The `DogfoodReport` SHALL reference the friction-driven commits made during the window. (Design D8; cohesive-landing criterion "data fed back into role prompts/skills".)

#### Scenario: Friction-driven prompt edits are traceable

- **WHEN** the dogfood window closes
- **THEN** the `DogfoodReport` lists the friction observations and the commit shas of the role/skill edits they motivated (or records that none were needed)

### Requirement: Expansion toward packages/api begins within the window but does not gate

Decoration + authoring work toward `packages/api` SHALL begin within the dogfood window as the v1.x on-ramp. It SHALL NOT be part of the go/no-go gate — the gate is `packages/shared` only. (Design D8.)

#### Scenario: API expansion is recorded but not gated

- **WHEN** the go/no-go evaluation runs
- **THEN** `packages/api` progress appears in the exploratory section only
- **AND** its state has no effect on the gating verdict
