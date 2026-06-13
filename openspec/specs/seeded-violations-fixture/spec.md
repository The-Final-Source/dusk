# seeded-violations-fixture Specification

## Purpose
TBD - created by archiving change phase-5-validation-benchmark-dogfood. Update Purpose after archive.
## Requirements
### Requirement: The fixture ships ~60 violations across four classes with full ground truth

`packages/fixtures/seeded-violations/` SHALL contain approximately 60 seeded violations across four classes, each a self-contained decorated file + intent files + a `fixture.yaml` carrying `{id, class, ground_truth_outcome, ground_truth_defect_loc: {file, line}, description, calibration?: boolean}`:

- **mechanical** (≈14, one-plus per gate rejection kind) — caught by the PreToolUse gate, expected 100%.
- **static-analysis** (≈10) — `S ⊄ D` erosion cases, caught by `dusk doctor --static-analysis`, NOT by the gate.
- **verification** (≈24) — Verifier-caught semantic defects, including ≥3 quantifier-cardinality cases, ≥3 `implies`-consequent-on-antecedent-true cases, and ≥3 negative-polarity-should-reject cases.
- **two-stage-test** (≈12) — tests that pass at runtime but fail the Verifier's test-body evaluation (caught pre-execution, not by the Test Runner).

The package SHALL be excluded from the pnpm workspace build (its code is deliberately broken). (Roadmap Sprint 9; design D7; **P5-T9** fixture half.)

#### Scenario: The fixture manifest covers all four classes at the documented scale

- **WHEN** the fixture manifest is built
- **THEN** it enumerates ≈60 fixtures across the four classes at the documented per-class counts
- **AND** every fixture carries `ground_truth_outcome` and `ground_truth_defect_loc`
- **AND** the verification class contains ≥3 quantifier, ≥3 implies-consequent, and ≥3 negative-polarity cases

#### Scenario: The broken fixture code never enters the workspace build

- **WHEN** `pnpm build` runs at the repo root
- **THEN** the seeded-violations package is not compiled (excluded from the workspace task graph)

### Requirement: ground_truth_defect_loc is drift-guarded by marker comments

Every seeded-bad fixture SHALL carry a `// SEEDED: <id>` marker comment on its defect line. The manifest build SHALL verify that each fixture's `ground_truth_defect_loc` points at a line containing its expected marker; any mismatch SHALL fail the manifest build. Editing a fixture without updating its location is therefore a build failure — `ground_truth_defect_loc` cannot silently rot. (Design D7; the audit's Axis 3 depends on its accuracy.)

#### Scenario: A drifted defect location fails the manifest build

- **WHEN** a fixture's defect line moves (an edit shifts the line number) without updating `fixture.yaml`
- **THEN** the manifest build fails naming the fixture id and the mismatched location

#### Scenario: Aligned markers build clean

- **WHEN** every fixture's `ground_truth_defect_loc` points at its `// SEEDED: <id>` marker line
- **THEN** the manifest builds successfully and emits `manifest.json`

### Requirement: Detection rates hold per violation class

Running the benchmark over the fixture SHALL demonstrate each class is caught by the layer designed to catch it: the **mechanical** class 100% gate-caught; the **static-analysis** class doctor-caught and NOT gate-caught; the **verification** class Verifier-caught (including the quantifier, implies-consequent, and negative-polarity cases); the **two-stage-test** class caught by the Verifier's test-body evaluation and NOT by the Test Runner. (RFC §3.1, §3.2.1, §3.4, §4.6, §8.9; **P5-T9**.)

#### Scenario: Per-class detection routes to the right layer

- **WHEN** the benchmark runs over the full fixture
- **THEN** every mechanical fixture is gate-rejected (100%)
- **AND** every static-analysis fixture is doctor-reported and none is gate-rejected
- **AND** the verification fixtures are Verifier-rejected (reported rate; includes the quantifier/implies/negative-polarity cases)
- **AND** every two-stage-test fixture is rejected by the Verifier's test-body pre-pass with the Test Runner never invoked on it

### Requirement: The calibration split is declared in fixture metadata

The held-out calibration split for the fresh-Verifier audit SHALL be declared via `calibration: true` flags on designated controversial/known-good fixtures in the manifest — the split is fixture-metadata, not an ad-hoc selection at calibration time. The audit's pre-registration intersection check binds to these declared ids. (Design Q4; `verifier-freshness-audit` pre-registration requirement.)

#### Scenario: The calibration split is manifest-declared

- **WHEN** the manifest is built
- **THEN** the calibration fixtures are identifiable by their `calibration: true` flag
- **AND** `dusk benchmark --calibrate-audit` selects exactly that set

