# benchmark-harness Specification

## Purpose
TBD - created by archiving change phase-5-validation-benchmark-dogfood. Update Purpose after archive.
## Requirements
### Requirement: The benchmark runs sequential per-model sweeps and derives all report sections from one stored manifest

`packages/runtime/benchmark` SHALL implement `dusk benchmark --models <m1,m2,…>` running one **complete fixture sweep per model, sequentially** (not interleaved). Every per-fixture verdict SHALL be stored in a run manifest (`.ia/observability/benchmark-runs/<run-id>/verdicts.jsonl`) keyed by `(fixture_id, model)`. Per-model per-class accuracy, per-role-per-model latency/cost, and the **cross-model Verifier-verdict agreement matrix** SHALL all be computed as pure post-passes over the stored manifest — no fixture is re-run for any report section. The `BenchmarkReport` shape SHALL be schema-validated in `@dusk/core-schema` (a v1.x-facing artifact format). (RFC §7.3, §7.4; design D6, D10; **P5-T13**.)

#### Scenario: A multi-model run produces the full report from one manifest

- **WHEN** `dusk benchmark --models m1,m2` runs over the seeded-violations fixture
- **THEN** the report carries per-model per-class accuracy, per-role-per-model latency/cost, and a cross-model agreement matrix
- **AND** every report section derives from the same stored `verdicts.jsonl` (verifiable: the manifest's verdict count equals fixtures × models, with no re-runs)
- **AND** the report parses against the `BenchmarkReport` schema

#### Scenario: The agreement matrix is a pure post-pass

- **WHEN** the agreement matrix is recomputed from an existing run manifest
- **THEN** the recomputation makes zero model calls and produces an identical matrix

### Requirement: The real-model confirmation-pass flake rate is characterized, never gated

The harness SHALL provide a high-N statistical characterization of first-call-reject → confirmation-outcome behavior on **clean** fixtures against the real frontier model at `temperature: 0`: run N first-call verdicts per clean fixture, and for each first-call reject, run the N=2 confirmation protocol and record the outcome. The output SHALL be a **report** of the observed flake/dismissal rate with tolerance bands. The test surface SHALL assert ONLY that the harness produces the report with its documented shape — **no specific rate is asserted** (the confirmation-pass *mechanism* was gated in P3-T14/T15 with the Verifier double; this characterizes the *variance assumption* behind it). (RFC §6.5, §7.5.1; **P5-T8**.)

#### Scenario: The flake-rate report is produced with tolerance bands

- **WHEN** the characterization runs over the clean fixture set against the real frontier model
- **THEN** a report is produced carrying the observed first-call-reject rate, the confirmation-dismissal rate, and tolerance bands
- **AND** the test asserts the report's shape and completeness — not any specific rate value

#### Scenario: The characterization is excluded from gating surfaces

- **WHEN** the phase's gating test suites run
- **THEN** no gate depends on the characterized flake rate (the report is informational; its absence — not its values — would fail the landing criteria)

### Requirement: Transport failures follow the pre-registered amendment

All real-model benchmark and audit legs SHALL apply the Phase-4 board's pre-registered transport-failure rule: a transport error (CLI timeout/exit, spawn errno, malformed envelope — classified via the test-harness's `isTransportError`) is a **null observation** that consumes a retry, never a silent pass; two transport deaths on the same observation fail that leg outright; assertion failures and programming errors are NEVER classified as transport noise. (Plan pre-registration; Phase-4 board S7.)

#### Scenario: Transport noise never converts to a pass

- **WHEN** a benchmark observation's model call dies with a transport-classified error twice
- **THEN** that observation's leg fails outright (it does not score as a pass or get silently skipped)
- **AND** a non-transport error (assertion failure) propagates immediately without consuming a retry

