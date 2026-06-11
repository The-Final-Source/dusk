## ADDED Requirements

### Requirement: Citation precision is a pure structural transform with zero model calls

`packages/runtime/benchmark` SHALL implement `scoreCitationPrecision(rationale, evidence, groundTruth, importGraph) → "aligned" | "adjacent" | "unaligned"` as a pure transform: extract candidate citations from the verdict's structured `evidence.focal_claim.lines` plus regex extraction over the rationale text; score `aligned` for any citation within ±2 lines of `ground_truth_defect_loc.line` in the correct file; `adjacent` for same-file-beyond-±2 OR a file in the 1-hop import set of the ground-truth file (computed with the same import-adjacency machinery the Phase-3 long cycle uses); `unaligned` otherwise — **including the no-citation-at-all case**, which SHALL additionally be flagged as its own condition. The scorer SHALL make zero model calls. (RFC §7.5.1; design D2; **P5-T2** — unit-only.)

#### Scenario: The three-tier scoring table holds

- **WHEN** verdict rationales with known `file:line` citations are scored against a fixture `ground_truth_defect_loc`
- **THEN** a citation within ±2 lines in the same file scores `aligned`
- **AND** a same-file citation beyond ±2 lines scores `adjacent`
- **AND** a citation in a 1-hop-import file scores `adjacent`
- **AND** a wrong-file citation scores `unaligned`
- **AND** an absent citation scores `unaligned` AND raises the no-citation flag

#### Scenario: The scorer makes zero model calls

- **WHEN** the full scoring pass runs over a fixture set
- **THEN** the trace stream records zero model invocations attributable to the scorer

### Requirement: Audit thresholds are pre-registered in a checked-in artifact and mechanically enforced

The pass bars SHALL live in `packages/runtime/benchmark/audit-thresholds.json`, validated by the `AuditThresholds` Zod schema in `@dusk/core-schema`, carrying `calibrated_at`, `calibration_fixture_ids[]`, `frozen: true`, and explicit numeric bars for all three axes (Axis 1 variance entropy bounds; Axis 2 similarity bound; Axis 3 `min_pct_fixtures_aligned_4of5 ≥ 0.80` + `max_pct_fixtures_all_unaligned ≤ 0.05`). `dusk benchmark --calibrate-audit` SHALL write this file from a run over the calibration split ONLY (fixtures flagged `calibration: true` in the manifest, per design Q4). The audit SHALL refuse to run with a typed error if the file is absent, `frozen !== true`, or the intersection of `calibration_fixture_ids` and the about-to-be-scored fixture set is non-empty — calibration data is never test data, by construction. (RFC §7.5; design D1, Q4; **P5-T3** protocol half.)

#### Scenario: The audit refuses to score without frozen thresholds

- **WHEN** `--audit-verifier-freshness` is invoked and `audit-thresholds.json` is absent
- **THEN** the run returns a typed error naming the missing pre-registration
- **AND** no fixture is scored

#### Scenario: The audit refuses calibration/test overlap

- **WHEN** the thresholds file's `calibration_fixture_ids` intersects the fixture set about to be scored
- **THEN** the run returns a typed error naming the overlapping fixture ids
- **AND** no fixture is scored

#### Scenario: Calibration writes provenance

- **WHEN** `dusk benchmark --calibrate-audit` completes over the calibration-flagged split
- **THEN** the written `audit-thresholds.json` parses against the `AuditThresholds` schema with `frozen: true`, a Clock-injected `calibrated_at`, the exact calibration fixture ids, and numeric bars on all three axes

### Requirement: The standing audit produces three-axis data at N≥10 and flags the rubber-stamp quadrant

`--audit-verifier-freshness` SHALL run **N≥10 independent Verifier calls per fixture** over the known-bad set at `temperature: 0`, compute Axis 1 (verdict-variance Shannon entropy), Axis 2 (rationale token-overlap similarity), and Axis 3 (citation precision via the structural scorer), score all three against the pre-registered bars, and surface the **High-similarity × Low-precision quadrant** per the RFC §7.5.1 interpretation table. A Verifier producing no `file:line` citation SHALL be flagged via Axis 3 (all-`unaligned`) rather than silently degrading the audit. The audit SHALL use **no LLM-judge anywhere**. (RFC §7.5, §7.5.1; design D1, D2; **P5-T3**.)

#### Scenario: Known-bad set meets the pre-registered citation bar

- **WHEN** the audit runs at N≥10 over the known-bad fixture set with frozen thresholds
- **THEN** the report scores Axis 3 against the pre-registered bar (≥80% of fixtures with ≥4/5 `aligned`; ≤5% with 5/5 `unaligned`)
- **AND** Axes 1 and 2 are scored against their explicit numeric bars (not narrative judgment)

#### Scenario: A planted rubber-stamping prompt variant lands in the flagged quadrant

- **WHEN** the audit runs against a deliberately rubber-stamping Verifier prompt variant
- **THEN** the report flags that variant in the High-similarity × Low-precision quadrant per the §7.5.1 table

#### Scenario: A no-citation Verifier is flagged, not silently passed

- **WHEN** a Verifier variant produces rationales with no `file:line` citations
- **THEN** its Axis-3 scores are all-`unaligned` with the no-citation flag raised
- **AND** the audit reports the condition explicitly rather than omitting the variant

### Requirement: Organic confirmation-pass data forms a distinct, bias-annotated cohort

Confirmation-pass Verifier calls (correlated via `confirmation_of_trace_id` from the trace stream) SHALL aggregate into a **separate "organic" cohort** in the audit report, never blended with the curated baseline. The organic cohort's report section SHALL carry an explicit selection-bias annotation — `selection: "first-call-rejected"` and `precision_not_comparable_to_curated: true` — so the no-blended-metrics rule is enforced mechanically in the artifact shape. (RFC §7.5.1; design D8 separation principle; **P5-T4**.)

#### Scenario: Organic cohort aggregates separately with the bias annotation

- **WHEN** a pipeline run has produced confirmation calls and the audit subsequently runs
- **THEN** those calls appear in a distinct `organic` cohort section of the `AuditReport`
- **AND** that section carries `selection: "first-call-rejected"` and `precision_not_comparable_to_curated: true`
- **AND** the curated baseline's scores are computed without the organic data
