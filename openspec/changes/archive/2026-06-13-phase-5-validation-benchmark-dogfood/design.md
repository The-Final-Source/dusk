## Context

Phase 5 is the **measurement phase** — the last phase of v1. Phases 1–4 built the machine; this phase converts its load-bearing claims into measured properties and then runs the whole system on real code. Three measurement instruments ship (the three-axis fresh-Verifier audit, the seeded-violations benchmark, the static-analysis drift detector), one standing regression ships (the worked example in CI), and one operational validation ships (the dogfood on `packages/shared` with hard go/no-go thresholds).

The constraints carry the most board history of any phase. The round-4 board rejected the original audit design twice: first for using an LLM-judge on the citation axis (which would re-introduce the correlation being measured), then for "vibes" thresholds on Axes 1/2 and a conflated calibration/test set. The shipped protocol is therefore strict: **structural scoring only, pre-registered numeric bars on all three axes, calibration data frozen before test data is scored, N≥10 standing runs, and the organic confirmation-pass cohort mechanically annotated for selection bias** (the no-blended-metrics rule from the engineering philosophy, enforced in code). Similarly, the dogfood gate originally read "≥2 weeks of data collected" — the board called this "not a real gate" and the shipped version asserts named go/no-go thresholds.

Phase 5 also touches the production app packages (`packages/api`, `packages/web`) for the first time — light-touch ecosystem skeletons only, per the CLAUDE.md platform-distribution note (registry/dashboard capabilities live in the existing packages, never a new `platform/` package).

One structural note: Phase 5 has **no new frozen seams for a later phase to consume** — it is the terminal phase. What it pins instead are the **v1.x-facing artifact formats** (the audit-thresholds file, the benchmark report schema, the operational-metrics schema) that post-v1 work will read.

## Goals / Non-Goals

**Goals:**

- Define the pre-registration protocol mechanically — where frozen thresholds live, how calibration/test separation is enforced in code, what the audit refuses to do when the protocol is violated.
- Define the citation-precision scorer as a pure structural transform with zero model calls.
- Define the trace ring buffer + the out-of-band mirror architecture such that an unreachable sink structurally cannot block a run.
- Define the static-analysis call-graph construction with the conservative-default policy as a pure fold.
- Define the benchmark's model-matrix execution and the cross-model agreement computation.
- Define the seeded-fixture authoring strategy (four classes, ~60 violations, `ground_truth_defect_loc` maintenance).
- Define the dogfood operational protocol — what gates, what's exploratory, where data lands, how friction feeds back.
- Define the ecosystem-skeleton boundaries precisely enough that "routable/renderable, not feature-complete" is a checkable bar.

**Non-Goals:**

- Everything on the roadmap's explicit v1.x deferral list (semantic/vector search, canonical library, noun-phrase expansion, heterogeneous per-role models, per-intent claim minimum, hard sandboxing, CLAUDE.md hard enforcement, legacy bootstrap, exhaustive verification, multi-language decoration, multi-framework coexistence, Orchestrator split, polyglot test runners, curated-vocabulary SSoT).
- Feature-complete registry/dashboard UX. Skeletons only.
- Reshaping any Phase 1–4 capability. Every seam is consumed as-is; the trace fields Phases 2/3 reserved are populated, not redefined.
- New recovery machinery. The Recovery Ladder shipped and was gated in Phase 3; this phase only consumes its artifacts in dogfood traces.

## Decisions

### D1 — Pre-registration is enforced by a checked-in thresholds file with provenance, and the audit refuses to score without it

The frozen bars live in a checked-in artifact: `packages/runtime/benchmark/audit-thresholds.json`, validated by an `AuditThresholds` Zod schema in `@dusk/core-schema`:

```typescript
type AuditThresholds = {
  schema_version: 1;
  calibrated_at: string;                  // Clock-injected ISO 8601
  calibration_fixture_ids: string[];      // the held-out controversial/known-good split
  frozen: true;                           // literal — the file IS the freeze
  axis1_variance: { max_entropy_known_bad: number; min_entropy_controversial: number };
  axis2_similarity: { max_token_overlap_low_precision_flag: number };
  axis3_citation: { min_pct_fixtures_aligned_4of5: number;   // ≥ 0.80
                    max_pct_fixtures_all_unaligned: number };  // ≤ 0.05
};
```

**Mechanical enforcement:** the calibration script (`dusk benchmark --calibrate-audit`) writes this file from a run over the calibration split only, recording the fixture ids it used. The audit (`--audit-verifier-freshness`) **refuses to run** (typed error) if (a) the thresholds file is absent, (b) `frozen !== true`, or (c) the intersection of `calibration_fixture_ids` and the about-to-be-scored fixture set is non-empty. Calibration data can never be test data — by construction, not by discipline.

**Alternative considered:** thresholds as constants in source. Rejected — constants have no provenance (when were they calibrated, against what split?) and editing them is invisible to review; a schema-validated artifact with a recorded calibration set makes threshold drift auditable.

### D2 — The citation-precision scorer is a pure structural transform; the 1-hop check reuses Phase-3 adjacency

`scoreCitationPrecision(rationale: string, evidence: VerdictEvidence, groundTruth: GroundTruthDefectLoc, importGraph: ImportAdjacency) → "aligned" | "adjacent" | "unaligned"`:

1. Extract candidate citations: the verdict's structured `evidence.focal_claim.lines` field PLUS regex extraction over the rationale text (`(\S+\.(ts|tsx|js|jsx|mts|cts)):(\d+)` and bare `lines? \d+(-\d+)?` forms anchored to a file mention).
2. `aligned` ⇔ any citation within ±2 lines of `groundTruth.line` in `groundTruth.file`.
3. `adjacent` ⇔ same file but outside ±2, OR a file in the 1-hop import set of `groundTruth.file` — computed with the **same import-adjacency machinery the Phase-3 long cycle uses** (one source of truth for "1-hop").
4. `unaligned` ⇔ everything else, **including the no-citation-at-all case** (which the audit reports as its own flag, per the board's "never silently degrade" requirement).

Zero model calls — asserted in tests by trace inspection (P5-T2 unit-only). The scorer is deliberately a leaf function so the audit, the benchmark, and any v1.x dashboard all call the identical implementation.

### D3 — `traces.jsonl` ring buffer: size-bounded rotation with an audit-pinning escape hatch

The trace file rotates at a configurable byte ceiling (`observability.trace_ring_bytes`, default 64 MiB): on exceeding it, `traces.jsonl` → `traces.1.jsonl` (one generation kept), and a fresh file starts. Rationale: dogfood runs for ≥2 weeks; unbounded JSONL on a busy repo would grow without limit, but the audit and the benchmark need recent-window completeness, not forever-history.

**Audit pinning:** when an audit or benchmark run starts, it snapshots the current file boundaries (`{file, byte_offset}`) and reads a consistent window — rotation during a run cannot drop events out from under it. Implementation: rotation renames, never truncates in place; an open read handle on the renamed file remains valid (POSIX semantics).

**Alternative considered:** SQLite-backed trace store. Rejected — the architecture explicitly removed the adherence SQLite DB ("satisfaction is computed on-demand from the in-memory index"); re-introducing a DB for traces contradicts that stance, and JSONL is sufficient for v1's read patterns (tail, window-scan, id-correlation).

### D4 — Mirrors are out-of-band file-tail forwarders; the pipeline never awaits a sink

The PostHog/OTLP mirrors are **separate forwarder processes/tasks that tail `traces.jsonl`** — they are not hooks in the trace-emission path. The pipeline's only I/O obligation is the local file append. A mirror that is unreachable, slow, or crashed affects nothing upstream: the pipeline cannot block on a sink it never awaits (P5-T12's property holds **structurally**, not via timeouts).

Forwarder lifecycle: started by `dusk serve`/the MCP server when `observability.mirrors[]` is configured; each forwarder keeps a cursor file (`.ia/observability/.cursor-<sink>`) so restarts resume without re-sending; delivery is at-least-once with the sink's own idempotency as the dedupe layer (both PostHog and OTLP tolerate replays).

**Alternative considered:** in-process async emit with a bounded queue + drop policy. Rejected — a bounded queue still couples pipeline latency to sink health under burst, and a drop policy silently loses traces (violates "no silent behavior"). File-tail forwarding decouples completely and loses nothing locally.

### D5 — Static-analysis call-graph: TS-AST over the decoration parse layer; conservative default as a pure fold

The `S ⊆ D` detector builds its call-graph from the **same TS parse layer `@dusk/core-decoration` already uses** (one parser stack — no second TS toolchain). For each decorated unit `U`:

- `D(U)` = the intent set declared by `U`'s decorators (from the derived index).
- `S(U)` = the union of intent participations of `U`'s called sub-operations: for each call site in `U`'s body, resolve the callee; if the callee is decorated, contribute its focal intents; **if the callee is uninstrumented, contribute ∅ (conservative default)** — a pure fold, no heuristics.
- Finding ⇔ `S(U) ⊄ D(U)`, reported with `file:line` + a suggested decomposition (the offending callee's intents named).

`--strict-unknowns` changes exactly one thing: uninstrumented callees additionally emit an `undecorated_callee` finding (their own class, never conflated with `S ⊄ D`). Cross-file resolution uses the import graph; unresolvable dynamic calls (computed property access, indirect invocation) are treated as uninstrumented (conservative). The whole detector is zero-model.

**Conflicts-pair co-decoration (P5-T7)** is a separate, simpler doctor pass: for every `conflicts` edge (A, B) in the intent graph, scan the index for any file region carrying decorations of both A and B → report with `file:line`. Pure index query.

### D6 — Benchmark model matrix: sequential per-model sweeps over one fixture manifest; agreement computed from stored verdicts

`dusk benchmark --models m1,m2,…` runs one **complete fixture sweep per model, sequentially** (not interleaved — keeps per-model cost attribution clean and avoids cross-model rate-limit interference). Every per-fixture verdict is stored in a run manifest (`.ia/observability/benchmark-runs/<run-id>/verdicts.jsonl`) keyed by `(fixture_id, model)`. The cross-model agreement matrix is then a **pure post-pass** over the stored verdicts — no re-running. Per-class accuracy, per-role latency/cost, and the agreement matrix all derive from the same manifest, so the report is internally consistent by construction.

The `BenchmarkReport` shape is schema-validated in `@dusk/core-schema` (a v1.x-facing artifact format — dashboards will read it).

### D7 — Seeded fixtures are a non-workspace mini-package with a generated manifest

`packages/fixtures/seeded-violations/` is **excluded from the pnpm workspace build** (its code is deliberately broken — it must never compile as part of `pnpm build`). Layout: one directory per class (`mechanical/`, `static-analysis/`, `verification/`, `two-stage-test/`), each violation a self-contained decorated file + its intent files + a `fixture.yaml` carrying `{id, class, ground_truth_outcome, ground_truth_defect_loc: {file, line}, description}`.

**Manifest generation + drift guard:** a build script assembles `manifest.json` from the `fixture.yaml`s and **verifies every `ground_truth_defect_loc` still points at a line containing its expected marker comment** (`// SEEDED: <id>` on the defect line). Editing a fixture without updating the location fails the manifest build — `ground_truth_defect_loc` cannot silently rot (the audit's Axis 3 depends on its accuracy).

Class counts (~60 total): mechanical ≈ 14 (one-plus per rejection kind, the gate's 12-kind surface), static-analysis ≈ 10, verification ≈ 24 (incl. ≥3 quantifier-cardinality, ≥3 `implies`-consequent-on-antecedent-true, ≥3 negative-polarity-should-reject), two-stage-test ≈ 12.

### D8 — Dogfood protocol: a calendar window with an evaluation script; gates and exploratory metrics separated in the artifact

The dogfood is a **calendar gate (≥14 days from first decorated commit on `packages/shared`) plus an evaluation script**, not a vibes review. Operational data lands in `.ia/observability/dogfood/` as dated JSONL (run outcomes, gate events, doctor reports, friction notes). `dusk benchmark --evaluate-dogfood` reads the window and emits a `DogfoodReport` (schema-validated):

- **Gating section** (hard, named in P5-T11): `e2e_implement_success_count ≥ 1` (a mergeable commit with full trailers), `gate_false_positive_count == 0` on the decorated package, `worked_example_regression == clean`, `package_test_suite == green`.
- **Exploratory section** (explicitly non-gating, labeled as such in the artifact): iteration distributions, Author branching distributions, stuckness-fire rates, doctor finding trends.

Friction feedback loops into role prompts/skills as ordinary commits during the window (the role files and skills are versioned files — dogfood-driven edits are just commits, reviewed like any other). The go/no-go evaluation is re-runnable and deterministic over the collected data.

**`packages/api` expansion** starts within the window but is **not** part of the gate (the gate is `packages/shared`; api expansion is the v1.x on-ramp).

### D9 — Ecosystem skeletons: three tRPC routes, three web views, acceptance = "responds with real data from a decorated package"

Scope is fixed and small:

- **`packages/api`** — a `registry` tRPC router with `searchCanonicalIntents` (name/description substring over `packages/intents/canonical/`), `getCanonicalIntent` (one intent's YAML), and `getAdherenceSummary` (hierarchical satisfaction for a named package, computed from the derived index on demand — no adherence DB). Standard Zod-validated procedures per the repo's tRPC conventions.
- **`packages/web`** — three views: **Adherence** (per-intent satisfaction rollup), **Intent tree** (the hierarchical intent graph), **Decoration coverage** (decorated-vs-undecorated unit counts per file). Each renders against `getAdherenceSummary`/registry data for a decorated package.

"Routable/renderable, not feature-complete" as a checkable bar: each route returns a schema-valid non-error response against the dogfooded `packages/shared`; each view renders without runtime errors and displays that data. No pagination, no auth surface changes, no editing, no live updates — explicitly out.

### D10 — v1.x-facing artifact formats pinned in `@dusk/core-schema`

Phase 5 is terminal — no later phase consumes its seams — but post-v1 work (dashboards, threshold re-calibration, benchmark trend analysis) reads its artifacts. Pinned shapes: `AuditThresholds` (D1), `AuditReport` (three-axis results + cohort sections + quadrant flags), `BenchmarkReport` (D6), `DogfoodReport` (D8), `StaticAnalysisReport` (findings + density baseline). All in `@dusk/core-schema` per the Phases 2–4 convention.

## Risks / Trade-offs

- **[Calibration split too small to set stable bars]** — the curated fixture set is finite; a noisy calibration yields brittle frozen thresholds. **Mitigation:** the calibration script reports confidence intervals alongside the bars; if an interval is too wide to freeze responsibly, widen the calibration split *before* freezing (the protocol permits re-calibration freely — it only forbids scoring test data first).
- **[Real-model audit cost]** — N≥10 across the fixture set × the standing cadence is the most expensive test surface in v1. **Mitigation:** the audit is gated behind the correctness env-var (nightly/on-demand, never per-PR), per the Phase 2–4 convention; the P5-T8 characterization shares the same gating.
- **[`ground_truth_defect_loc` rot]** — fixture edits silently invalidating Axis 3's ground truth. **Mitigation:** the D7 marker-comment drift guard fails the manifest build on any mismatch.
- **[Static-analysis false negatives from the conservative default]** — uninstrumented callees contribute ∅, so erosion hidden behind undecorated helpers is invisible in default mode. **Mitigation:** this is the designed trade-off (no false-positive floods); `--strict-unknowns` exists precisely to surface the blind spot, and the dogfood runs both modes periodically.
- **[Dogfood window discovers a Phase 1–4 defect]** — running on real code may surface bugs in archived phases. **Mitigation:** fixes are ordinary bugfix commits against the affected package with regression tests; the living specs are amended per the Fowler policy ("archives are history; main specs are the contract") if behavior was mis-specified. The dogfood gate does not archive until the go/no-go thresholds pass against the fixed system.
- **[App-package coupling]** — touching `packages/api`/`web` risks destabilizing production-ready code. **Mitigation:** additive-only changes (new router, new views); their existing test suites are part of the phase's landing criteria; no existing route/view is modified.
- **[Mirror forwarder lag]** — file-tail forwarding can fall behind under burst. **Mitigation:** acceptable by design — mirrors are observability conveniences with at-least-once delivery; `traces.jsonl` is the source of truth and is always complete.

## Migration Plan

Phase 4 is archived; 27 capabilities are canonical. Phase 5 lands as a single change. No production-data migration: the trace fields being completed are already reserved/optional in the `SubAgentTrace` schema (additive population, not reshaping); `dusk.config.yml` gains an `observability` block (`trace_ring_bytes`, `mirrors[]`) — additive, defaults preserve current behavior; the fixtures are new packages; the app-package additions are new routers/views. Rollback = `git revert` of the merge commit; the only persistent artifacts (`audit-thresholds.json`, benchmark/dogfood run data under `.ia/observability/`) are inert files.

## Open Questions

- **Q1 — Which package's decorated code seeds the static-analysis baseline report in the smoke test?** **Resolution:** the dogfooded `packages/shared` — the smoke's measurement half runs `--static-analysis` over it after decoration, producing the density baseline the cohesive-landing criteria name. The seeded static-analysis fixtures gate correctness (P5-T5/T6); the real package gates operability.
- **Q2 — Does the audit read `DialogState` transcripts in v1?** The proposal notes transcripts are "audit-reachable." **Resolution:** reachable but not scored in v1 — the audit's three axes are Verifier-focused. The `AuditReport` schema reserves an optional `dialog_transcript_refs[]` field so v1.x can correlate authoring decisions with verdict outcomes without a schema break. No v1 test asserts transcript scoring.
- **Q3 — PostHog and OTLP both, or one?** **Resolution:** the forwarder architecture is sink-generic (D4); v1 ships the OTLP forwarder implemented + tested (P5-T12 uses it with an unreachable endpoint) and the PostHog forwarder as a thin adapter over the same tail-cursor machinery. Both configured via `observability.mirrors[]`.
- **Q4 — Where does `--calibrate-audit` get its controversial/known-good split?** **Resolution:** from the seeded-violations manifest's class tags plus a `calibration: true` flag on designated fixtures — the split is declared in fixture metadata, not chosen ad hoc at calibration time. The D1 intersection check then has an unambiguous fixture-id basis.
