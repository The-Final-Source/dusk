# static-analysis-doctor Specification

## Purpose
TBD - created by archiving change phase-5-validation-benchmark-dogfood. Update Purpose after archive.
## Requirements
### Requirement: `dusk doctor --static-analysis` detects `S ⊄ D` with the conservative uninstrumented-callee default

The CLI SHALL provide `dusk doctor --static-analysis` implementing the decoration-erosion drift detector: build the call-graph from the same TS parse layer `@dusk/core-decoration` uses (no second toolchain); for each decorated unit `U`, compute `D(U)` (declared intents from the derived index) and `S(U)` (the union of focal-intent participations of `U`'s resolved callees) as a pure fold; report every `S(U) ⊄ D(U)` with `file:line` and a suggested decomposition naming the offending callee's intents. **Conservative default:** uninstrumented callees contribute the empty intent set — no spurious findings; unresolvable dynamic calls are treated as uninstrumented. The detector SHALL be zero-model and framed as drift detection (off the write path), never real-time enforcement. (RFC §4.6, §8.9; design D5; **P5-T5**.)

#### Scenario: Every seeded `S ⊄ D` violation is reported with location and suggestion

- **WHEN** `dusk doctor --static-analysis` runs over the seeded static-analysis fixture class
- **THEN** every seeded `S ⊄ D` violation is reported with `file:line` and a suggested decomposition
- **AND** no model call is made

#### Scenario: Uninstrumented callees produce no spurious findings in default mode

- **WHEN** the analyzed code calls undecorated helper functions
- **THEN** those callees contribute empty intent sets to `S(U)`
- **AND** no finding is produced for them in default (conservative) mode

### Requirement: `--strict-unknowns` surfaces undecorated callees as their own finding class

`dusk doctor --static-analysis --strict-unknowns` SHALL additionally emit an `undecorated_callee` finding for every uninstrumented callee reached from a decorated unit — a distinct finding class, never conflated with `S ⊄ D` findings. (RFC §8.9; design D5; **P5-T6**.)

#### Scenario: Strict mode separates the two finding classes

- **WHEN** `--strict-unknowns` runs over a fixture containing both a true `S ⊄ D` violation and uninstrumented callees
- **THEN** the report contains the `S ⊄ D` finding under its class AND `undecorated_callee` findings under theirs
- **AND** the two classes are separately countable in the structured report

### Requirement: `dusk doctor` flags conflicts-pair co-decoration

`dusk doctor` (base run) SHALL implement the off-write-path half of the `conflicts` typed-edge semantics: for every `conflicts` edge (A, B) in the intent graph, scan the derived index for any file region carrying decorations of both A and B, and report each co-decoration with `file:line`. This complements the Decomposer's bead-issue-time hard refusal (Phase 3). Pure index query — zero-model. (RFC §2.1 `conflicts` row; **P5-T7**.)

#### Scenario: Co-decorated conflicts pair is reported

- **WHEN** intents A and B are linked `conflicts` and one file carries both `@intent A` and `@intent B`, and `dusk doctor` runs
- **THEN** the report flags the conflicting co-decoration with `file:line` naming both intents

#### Scenario: Non-conflicting co-decoration is not flagged

- **WHEN** a file carries decorations of two intents with no `conflicts` edge between them
- **THEN** no conflicts-pair finding is produced

### Requirement: The static-analysis report is structured with severity and a density baseline

The `--static-analysis` output SHALL be a structured `StaticAnalysisReport` (schema-validated in `@dusk/core-schema`) carrying per-finding `{class, file, line, intents_involved, suggestion, severity}` plus a decoration-density baseline (decorated-vs-undecorated unit counts per file) suitable for drift trending across runs. (RFC §8.9 drift framing; design D10.)

#### Scenario: The report parses and carries the density baseline

- **WHEN** `--static-analysis` completes over a decorated package
- **THEN** the output parses against the `StaticAnalysisReport` schema
- **AND** it includes per-file decorated/undecorated unit counts alongside the findings

