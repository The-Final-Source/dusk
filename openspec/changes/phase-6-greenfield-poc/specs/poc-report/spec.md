## ADDED Requirements

### Requirement: `PocReport` is a new sibling schema modeled on `DogfoodReport`'s gating/exploratory pattern, not a literal reuse

A new `PocReport` schema SHALL be added to `@dusk/core-schema` (defined once in Zod, type via `z.infer`). It SHALL follow `DogfoodReport`'s two-section structure — a `.strict()` **gating** section structurally separated from a `gating: z.literal(false)` **exploratory** section (the no-blended-metrics rule, enforced structurally) — but SHALL NOT reuse `DogfoodReportSchema`, whose gating section is `.strict()`-locked to its own four dogfood thresholds. The POC's hard gates differ and are more. Each gating field SHALL be a `.strict()` `{ value, threshold, pass }` gated metric (mirroring `DogfoodReport`'s `gatedCount` helper). (Plan Phase 6 Scope; design D9; **P6 cohesive landing**.)

#### Scenario: The schema enforces the gating/exploratory split structurally

- **WHEN** a `PocReport` is parsed
- **THEN** the gating section is `.strict()` and accepts only the named POC gates with pass/fail values
- **AND** the exploratory section is labeled `gating: false`
- **AND** no exploratory metric can appear in the gating section

### Requirement: The `PocReport` gating section carries exactly the POC hard gates

The gating section SHALL carry exactly these hard gates, each with an explicit threshold and pass/fail: zero hand-written application code (the trailer audit is clean); all endpoints landed via `dusk_implement` with mergeable commits; the POC's full pyramid green against live infrastructure; gate false-positive rate = 0 on the POC; intent tree 100% dialog-authored; static analysis clean in both modes. A top-level `pass` SHALL be true only if all gates pass. (Plan cohesive-landing criteria lines 915–923; design D9.)

#### Scenario: The gating verdict reflects every hard gate

- **WHEN** the gating section is evaluated
- **THEN** each hard gate carries its own pass/fail
- **AND** the section `pass` is true only when all hard gates pass

### Requirement: The `PocReport` exploratory section carries non-gating greenfield-friction data

The exploratory section SHALL carry, labeled `gating: false`: dialog turn counts, Stage-3 proposal acceptance rate, iteration distributions, pause/resume frequency, intent-granularity stats, and time-to-endpoint. It SHALL also reference the friction-driven role-prompt/skill edits (commit shas) made in the dusk repo during the build, or record that none were needed. These metrics seed the v1.x backlog and never gate. (Plan cohesive-landing criteria; design D9.)

#### Scenario: Friction data is recorded without gating

- **WHEN** the report is emitted
- **THEN** the exploratory section carries the friction distributions and the friction-driven commit shas
- **AND** none of these values affects the gating verdict

### Requirement: The `PocReport` evaluator is a zero-model, deterministic, re-runnable pure pass

The evaluator that fills the `PocReport` SHALL be a zero-model pure pass over the POC's `git log`, `traces.jsonl`, and `dusk doctor` output. Re-running it over the same inputs SHALL produce an identical report. The evaluator + the trailer auditor + the transcript checker live under `packages/runtime/benchmark` (extension — the same home as the dogfood evaluator). (Plan Phase 6 Scope; design D9; determinism posture.)

#### Scenario: The evaluation is deterministic

- **WHEN** the evaluator runs twice over the same collected POC data
- **THEN** it makes no model calls and produces two identical `PocReport` artifacts
