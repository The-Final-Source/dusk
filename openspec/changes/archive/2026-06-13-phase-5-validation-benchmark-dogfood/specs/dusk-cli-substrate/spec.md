## ADDED Requirements

### Requirement: The CLI exposes the Phase-5 measurement commands

The `dusk` CLI SHALL gain: `dusk benchmark` (the per-model harness; flags `--models <list>`, `--audit-verifier-freshness`, `--calibrate-audit`, `--evaluate-dogfood`) and `dusk doctor --static-analysis` (with `--strict-unknowns`). `/dusk-benchmark` SHALL be exposed as the slash-command wrapper over `dusk benchmark` per the established thin-wrapper pattern. Every new command and flag SHALL support `--help` with a usage description and at least one example. Exit codes: 0 on success/report-produced; non-zero on typed errors (including the audit's pre-registration refusals). (RFC §10.2; design D1, D5, D6, D8; Phase-5 CLI surface.)

#### Scenario: `dusk benchmark` runs the harness and writes the report

- **WHEN** `dusk benchmark --models <m1>` is invoked over the seeded fixture
- **THEN** the run manifest and `BenchmarkReport` are written under `.ia/observability/benchmark-runs/<run-id>/`
- **AND** the command exits 0 with a human-readable summary

#### Scenario: `dusk benchmark --audit-verifier-freshness` enforces pre-registration at the CLI

- **WHEN** the audit flag is invoked without a frozen `audit-thresholds.json`
- **THEN** the command prints the typed pre-registration error and exits non-zero

#### Scenario: `dusk doctor --static-analysis` produces the structured report

- **WHEN** `dusk doctor --static-analysis` runs over a decorated package
- **THEN** the `StaticAnalysisReport` is emitted with findings + the density baseline
- **AND** adding `--strict-unknowns` adds the `undecorated_callee` class to the same report shape

#### Scenario: Every new command and flag supports --help

- **WHEN** `dusk benchmark --help` and `dusk doctor --static-analysis --help` are invoked
- **THEN** each prints a usage description, the flag list, and at least one example invocation, and exits 0
