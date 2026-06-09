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

