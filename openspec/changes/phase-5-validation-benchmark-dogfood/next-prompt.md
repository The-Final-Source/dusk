# Handoff Prompt — Implement Dusk Phase 5 (Validation, Benchmarking & Dogfooding)

> Paste this whole file as the opening prompt for a **fresh Claude Code session**. It contains everything needed to implement Phase 5 of the Dusk v9 architecture accurately. The final instruction tells you exactly how to begin. **This is the final v1 phase — when its cohesive-landing checklist closes, v1 is landed.**

---

## 0. Your task in one paragraph

You are implementing **Phase 5 — Validation, Benchmarking & Dogfooding** of the Dusk v9 architecture. The work is already fully specified as an **OpenSpec change** at `openspec/changes/phase-5-validation-benchmark-dogfood/` (proposal + 9 capability specs + design + a dependency-ordered 36-task list). Your job is to **build the code that satisfies that change**, working `tasks.md` top to bottom, writing the behavioral tests as you go, until Phase 5's **cohesive-landing criteria** all pass — then the change is ready to archive and **v1 is complete**. **Do not redesign anything**: the architecture, the capability slicing, the decisions (D1–D10), the two-part smoke matrix, and the acceptance tests (P5-T1..T14) are settled. Phase 5 is the **measurement phase** — Phases 1–4 built the machine; this phase converts its load-bearing claims into measured properties (the three-axis fresh-Verifier audit, per-class detection rates, decoration-erosion drift detection) and then runs the whole system on real code (`packages/shared`) against hard go/no-go thresholds. Read the source-of-truth docs, then execute. **To begin, run `/openspec-apply-change` (target the `phase-5-validation-benchmark-dogfood` change).**

---

## 1. Mental model — what Dusk is

Dusk is a **constraint-satisfaction system for spec-driven AI development**. The endgame: humans stop reading/writing code and instead express **intents** via agent dialog; an orchestration harness turns intents into perfectly implemented, *adherent* code. Three layers:

1. **Constraint language** — **Intents** (atomic, hierarchical via slash-namespaced path) + **total code decoration**. The intent *is* the assertion. Phase 1 shipped this layer end-to-end.
2. **Solver** — nine bounded sub-agent roles drive a 9-step request→commit pipeline. Phase 2 shipped the spawn mechanism + roles + memory + read-only MCP + the scripted-verdict Verifier double. Phase 3 shipped the full 9-step pipeline (recovery ladder, livelock detection, pause/resume, cooperative cancel). Phase 4 shipped the 5-stage authoring dialog and closed the `dusk_implement` ↔ `dusk_author` loop.
3. **Verifier** — multi-agent evaluation with scoped focal+support evidence at `temperature: 0`, wired through the short cycle, long cycle, and two-stage test satisfaction.

**Phase 5 is where claims become measurements.** The Engineer ⊥ Verifier asymmetry is structurally protected (P2-T1/T3, P3-T8) but never *empirically audited* — the three-axis fresh-Verifier audit fixes that. Detection rates per violation class have never been measured against ground truth — the seeded-violations benchmark fixes that. Decoration erosion has no off-write-path detector — `dusk doctor --static-analysis` fixes that. And Dusk has never run on real code — the dogfood on `packages/shared` with hard go/no-go thresholds fixes that. **When this change archives, every row of the plan's commitment→phase coverage matrix is delivered and v1 is landed.**

---

## 2. Read these first (source of truth)

Read these in order. Do not skim — these are the contract you are implementing.

1. **`openspec/changes/phase-5-validation-benchmark-dogfood/proposal.md`** — what's changing and why; lists the 8 new capabilities + 1 modified; pins the cohesive-landing gate as the archival criterion.
2. **`openspec/changes/phase-5-validation-benchmark-dogfood/design.md`** — decisions D1–D10 (read all ten before writing code); the v1.x-facing artifact formats; risks + mitigations; resolved open questions Q1–Q4. **D1 (pre-registration mechanics) and D7 (fixture drift guard) carry the most board history — read them twice.**
3. **`openspec/changes/phase-5-validation-benchmark-dogfood/specs/`** — 9 capability spec files; 26 Requirements; 48 Scenarios. Every Scenario maps onto a P5-T* plan test. This is the acceptance contract.
4. **`openspec/changes/phase-5-validation-benchmark-dogfood/tasks.md`** — the 36-task implementation checklist in dependency order. Each task names its acceptance (capability spec scenario + P5-T* slug) and its Vitest test plan with explicit determinism surface. Work top-to-bottom, **but note the scheduling exception: the dogfood window (§11.1) starts as early as §2–§8 allow and runs concurrently — its ≥14-day calendar gate must not serialize onto the end.**
5. **`docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md`** — the v9 architecture spec. For Phase 5 specifically read end-to-end:
   - §2.1 (`conflicts` row — the doctor-flag half Phase 5 implements as P5-T7)
   - §4.6 + §8.9 (the `S ⊆ D` mandate + static-analysis drift framing — conservative default + `--strict-unknowns`)
   - §7.2 (trace stream + out-of-band sinks)
   - §7.3 + §7.4 (benchmark harness + per-role observability questions)
   - §7.5 + §7.5.1 (the fresh-Verifier audit + citation precision — **the load-bearing measurement sections; read very carefully**)
   - §8.2 (decorate-at-authorship — what the dogfood validates on a real leaf package)
   - Appendix A.6 (`SubAgentTrace` — every reserved field is populated this phase)
   - Appendix A.8 (the 12 rejection kinds — the mechanical fixture class covers them)
   - Appendix B (the worked example — the standing regression fixture)
6. **`docs/rfcs/001-mvp-rfc/intent-architecture-roadmap.md`** — Sprints 9–10 are this phase. The architectural commitments table is the v1 scope checklist.
7. **`docs/rfcs/001-mvp-rfc/v9-implementation-plan.md`** Phase 5 (lines 708–831) — the plan section; the P5-T* slugs come from here. **Then read the commitment → phase coverage matrix (lines 835–877)** — this is the ledger your phase completes — **and the round-4 board table (lines 881–898)** for why the audit protocol is shaped the way it is. **Re-read the two-part phase-landing smoke ("measure everything, then run for real") and the Cohesive landing criteria before you start.**
8. **`openspec/specs/`** — Phases 1–4's archived specs (27 capabilities), the canonical baseline. You are extending one (`dusk-cli-substrate`) and binding to many. **Do not modify any Phase 1–4 spec requirement** — bind to them. Note the Phase-4 board amendments already in the living specs (DraftIntent shape, payload tombstone, transport-failure protocol).
9. **The four archived `design.md` files** — `openspec/changes/archive/2026-06-09-phase-1-substrate/`, `…/2026-06-10-phase-2-runtime-verification/`, `…/2026-06-10-phase-3-implementation-pipeline/`, `…/2026-06-11-phase-4-intent-authoring/`. Phase 5 consumes seams from all four: the parser/decoration/index substrate (1), `SubAgentTrace`/`Verdict`/the scripted-verdict double/`ModelClient`/`raw_prompt` (2), the trace fields Phase 3 populated + import-adjacency machinery + `CommitTrailers` (3), `DialogState` (4 — audit-reachable, not scored in v1).
10. **`openspec/config.yaml`** — the per-phase delivery model. **One OpenSpec change per phase, non-negotiable.**
11. **`CLAUDE.md`** at the repo root — project conventions: TypeScript strict ESM, pnpm workspaces + Turborepo, `@dusk/*` namespace, Vitest, functional-first, Zod as source of truth, named exports, Result objects, factory functions, config via injection, files < 500 lines, colocated tests. **Note the platform-distribution rule: registry/dashboard capabilities live in the EXISTING `packages/api` + `packages/web` — never a new `platform/` package.** Phase 5 is the only phase that touches the app packages.

---

## 3. The contract (don't soften it)

### What ships in Phase 5

An operator can run `/dusk-benchmark` and get per-class detection rates against a seeded-violations fixture (mechanical class 100% gate-caught), and `--audit-verifier-freshness` and get **three-axis** data (verdict variance + rationale similarity + structurally-computed citation precision, **no LLM-judge**) scored against **pre-registered frozen thresholds**, flagging the rubber-stamp signature. `dusk doctor --static-analysis` catches decoration erosion with conservative + `--strict-unknowns` modes. The worked example verifies cleanly as a standing CI regression. Dusk has run on `packages/shared` for ≥14 days with **hard go/no-go thresholds** passing: ≥1 end-to-end `dusk_implement` producing a mergeable commit with full trailers, gate false-positive rate = 0, worked-example regression clean, the package's own tests green.

### What "ALL of v1" means for Phase 5

Every commitment in `tasks.md` and `specs/` ships. Specifically:

- **`packages/runtime/observability` complete** — every reserved `SubAgentTrace` v9 field populated (P5-T1); ring-buffered `traces.jsonl` with rename-based rotation + audit pinning; **out-of-band file-tail mirror forwarders** (OTLP implemented + tested with an unreachable endpoint; PostHog as an adapter) that structurally cannot block the pipeline (P5-T12).
- **The three-axis fresh-Verifier audit** — Axis 1 verdict-variance Shannon entropy, Axis 2 rationale token-overlap, Axis 3 **citation precision via pure structural parse** vs `ground_truth_defect_loc` (P5-T2 unit-only; the 1-hop "adjacent" check reuses the Phase-3 import-adjacency machinery). **Pre-registration enforced by construction**: `audit-thresholds.json` written by `--calibrate-audit` over the manifest-declared `calibration: true` split, with provenance; the audit **refuses to run** if the file is absent, unfrozen, or its calibration set intersects the scored set (P5-T3). N≥10 standing runs. The planted rubber-stamping prompt variant lands in the High-similarity × Low-precision quadrant. A no-citation Verifier is flagged, never silently degraded. The organic confirmation-pass cohort is **bias-annotated** (`selection: "first-call-rejected"`, `precision_not_comparable_to_curated: true`) and never blended with the curated baseline (P5-T4).
- **The benchmark harness** — sequential per-model sweeps over one stored manifest; per-class accuracy + per-role latency/cost + cross-model agreement matrix all as pure post-passes (P5-T13); the **P5-T8 flake-rate characterization is report-only, never gated** (the confirmation-pass mechanism was gated in P3-T14/T15).
- **`dusk doctor --static-analysis`** — `S ⊄ D` via the existing decoration parse layer; **conservative default** (uninstrumented + unresolvable-dynamic callees contribute ∅); `--strict-unknowns` adds the distinct `undecorated_callee` class (P5-T5/T6); the **conflicts-pair co-decoration flag** in the base doctor run (P5-T7); structured `StaticAnalysisReport` with a density baseline.
- **The seeded-violations fixture** — ~60 violations, four classes (mechanical ≈14 / static-analysis ≈10 / verification ≈24 incl. ≥3 quantifier + ≥3 implies-consequent + ≥3 negative-polarity / two-stage-test ≈12), every seeded-bad case carrying `ground_truth_outcome` + `ground_truth_defect_loc` **drift-guarded by `// SEEDED: <id>` marker comments that fail the manifest build on mismatch**; the package **excluded from the workspace build** (its code is deliberately broken); the calibration split declared in fixture metadata (P5-T9).
- **The worked-example regression** — App. B `sendNotification` as a standing fixture; parse/index/inspect leg on every PR unconditionally; real-model verify leg correctness-gated (P5-T10).
- **The dogfood** — `packages/shared`, ≥14 days from first decorated commit, the four named go/no-go thresholds asserted by a deterministic re-runnable `--evaluate-dogfood` script whose report **structurally separates gating from exploratory** sections; friction feedback lands as ordinary reviewed commits to role files/skills; `packages/api` expansion begins but does not gate (P5-T11).
- **Ecosystem skeletons** — a `registry` tRPC router (3 procedures) in the existing `packages/api` + three views (Adherence / Intent tree / Decoration coverage) in the existing `packages/web`; acceptance = "responds/renders with real data from the dogfooded package"; both app packages' existing test suites stay green (P5-T14).
- **CLI surface** — `dusk benchmark` (+ `--models`, `--audit-verifier-freshness`, `--calibrate-audit`, `--evaluate-dogfood`), `dusk doctor --static-analysis` (+ `--strict-unknowns`), `/dusk-benchmark` slash wrapper, `--help` everywhere.

### Non-goals (do NOT introduce)

**Only the roadmap's explicit v1.x deferral list is out of scope** — these are the *only* permitted omissions: semantic/vector search for Author Stage 2; runtime-fetched canonical intent library; noun-phrase-shared long-cycle expansion; heterogeneous per-role models; per-intent claim minimum; tool-scope/skill-scope hard sandboxing; CLAUDE.md binding hard enforcement; legacy bootstrap; exhaustive verification mode; multi-language decoration; multi-framework coexistence; Orchestrator state-machine split; polyglot test runners; curated-vocabulary SSoT. Also out: feature-complete registry/dashboard UX (skeletons only — no pagination, no auth changes, no editing, no live updates); an LLM-judge anywhere in the audit; a SQLite trace store (the architecture removed the adherence DB — JSONL is the trace backing); reshaping any Phase 1–4 capability; new recovery machinery (the ladder shipped and was gated in Phase 3).

---

## 4. Build philosophy — HARD constraints (do not soften)

### 4.1 Build the RIGHT thing the RIGHT way

No deference. No shortcuts. No `// TODO: v1.x`. The phase ships **whole** — every behavioral test passes, every cohesive-landing checkbox is true, then the change archives and v1 is landed.

### 4.2 Khorikov classical / behavior-focused testing

Same as Phases 2–4:
- **Test observable behavior, not implementation.** A refactor that preserves behavior must not break a test.
- **Real dependencies first.** Real file system, real hook process (mechanical fixture class), real git + real Vitest (dogfood), real frontier model (audit/benchmark, correctness-gated), real Postgres for the api router tests per the repo's conventions.
- **Mocks only for unmanaged dependencies.** Phase 5 has exactly ONE unmanaged dependency: the **unreachable mirror sink** in P5-T12 (mocked). Everything else is real or uses the established doubles (the scripted-verdict Verifier double standing in as a "model" for the benchmark's zero-model mechanics tests).
- **Each test asserts one unit of behavior.** Wiring/scaffolding does not need testing. Resistance to refactoring is non-negotiable.

### 4.3 Determinism testing posture

- **Zero-model surfaces** (most of the phase): the citation-precision scorer (pure transform), fixture authoring + the drift guard, static analysis (both modes + conflicts flag), the ring buffer + mirrors, report schemas, the audit's refusal paths, the benchmark's manifest mechanics + agreement post-pass (driven by the scripted-verdict double standing in as a model), the dogfood evaluation script (a pure pass over collected data), the ecosystem skeletons.
- **Real-frontier-model surfaces** (correctness-gated behind the env-var per the Phase 2–4 convention; ambient Claude Code CLI, **no `ANTHROPIC_API_KEY` required**): `--calibrate-audit` (4.2), the standing N≥10 audit (4.4), the rubber-stamp variant (4.5), the flake characterization (5.3, **report-only**), the worked-example verify leg (7.1b), the model-dependent benchmark classes (9.1), the dogfood's real runs (11.1), the smoke matrix (11.3).
- **The audit's own statistical protocol supersedes the N=3 ≥2/3 convention for its surface** — it IS the statistical instrument (pre-registered frozen bars, N≥10).
- **The pre-registered transport-failure amendment applies to every real-model leg** (Phase-4 board S7, pre-registered in the plan): transport-classified errors (`isTransportError` from `@dusk/test-harness`) are null observations consuming a retry; two transport deaths fail the leg outright; assertion failures and programming errors NEVER classify as transport noise.
- **Unit-only** is reserved for: the artifact schemas (1.2) and the citation-precision scorer (4.1).

### 4.4 Phase ships whole — cohesive landing is the archival gate

When you think you're done, run §11.4 of `tasks.md` against reality. Every box must be true:

- All P5-T1..T14 green against real dependencies; the scorer + fixtures use no model.
- The measurement + real-run smoke scenarios green; the four go/no-go thresholds pass.
- All new CLI commands/flags operable with `--help`.
- No carry-over: ALL v9 trace fields populated; NO LLM-judge in the audit; pre-registered frozen bars; every seeded-bad fixture drift-guarded.
- ≥14 days of dogfood on `packages/shared` with friction data fed back as reviewed commits; `packages/api` expansion begun (non-gating); skeletons routable/renderable; both app-package suites green.
- `openspec validate phase-5-validation-benchmark-dogfood --strict` passes.
- **The commitment → phase coverage matrix is fully delivered. v1 is complete.**

Then archive via `/openspec-archive-change phase-5-validation-benchmark-dogfood`.

---

## 5. Cross-change interface seams

### 5.1 Phase 1–4 seams — Phase 5 BINDS, never reshapes

- **Parser/decoration/index substrate** (Phase 1) — the static-analysis call-graph builds on `@dusk/core-decoration`'s parse layer (NO second TS toolchain); `D(U)` comes from the derived index; the doctor's conflicts-pair flag is a pure index query.
- **`SubAgentTrace`** (Phase 2, fields reserved across 2–3) — Phase 5 **populates** every reserved field; the schema shape is unchanged. `convergence_diagnosis_present` appears ONLY on Bead-Orchestrator events.
- **The scripted-verdict Verifier double + `raw_prompt` capture + injectable `Clock`** (Phases 1–2) — the zero-model test surfaces throughout.
- **`ModelClient`** (Phase 2 — ambient Claude Code CLI) — every real-model leg.
- **The import-adjacency machinery** (Phase 3 long cycle) — the citation scorer's 1-hop "adjacent" check reuses it (one source of truth for "1-hop").
- **`confirmation_of_trace_id` / `confirmation_pass_outcome`** (Phase 3) — the organic audit cohort aggregates via these.
- **`CommitTrailers` / `CancelResult` / `TestVerifierLivelockReport` / `TestVerdict`** (Phase 3) — consumed in dogfood traces and the go/no-go evaluation.
- **`DialogState`** (Phase 4) — audit-*reachable* but NOT scored in v1; the `AuditReport` reserves `dialog_transcript_refs[]` for v1.x (design Q2).
- **The transport-failure protocol + `isTransportError`** (Phase 4 board S7) — applied at both levels on every real-model leg.
- **`dusk.config.yml` shape** (Phase 1) — gains the additive `observability` block (`trace_ring_bytes`, `mirrors[]`); defaults preserve current behavior.

### 5.2 Phase 5 pins v1.x-facing artifact formats in `@dusk/core-schema`

Phase 5 is terminal — no Phase 6 consumes its seams. What it pins are the artifact formats post-v1 work reads: **`AuditThresholds`** (with `frozen: true` literal + calibration provenance), **`AuditReport`** (three-axis + cohorts + quadrant flags + reserved `dialog_transcript_refs[]`), **`BenchmarkReport`**, **`DogfoodReport`** (gating section = exactly the four thresholds; exploratory section labeled `gating: false`), **`StaticAnalysisReport`** (findings + density baseline). All in `@dusk/core-schema` per the Phases 2–4 convention.

---

## 6. Implementation approach — how to actually do this

### 6.1 Use `/openspec-apply-change`

```
/openspec-apply-change phase-5-validation-benchmark-dogfood
```

This walks `tasks.md` top-to-bottom. For each task: implement, write the named test, run it against the named determinism surface, check the box. Atomic conventional commits per task or small group — Phase 4 produced ~15 commits across 47 tasks; Phase 5's 36 tasks should produce 12–25 commits.

### 6.2 Respect dependency order — and START THE DOGFOOD EARLY

`tasks.md` is ordered by dependency, with one critical scheduling exception: **§11.1 (the dogfood window) has a ≥14-calendar-day gate. Start it as soon as §2–§8 allow** (you need the trace stream, the gate, and the pipeline operational — all of which shipped in Phases 1–4; the Phase-5 prerequisite is mostly the observability completion in §2). Let the window run concurrently while you work §9–§10. If you serialize the dogfood onto the end, you add two dead weeks.

Other safe forks: §3 (fixtures) ∥ §2 (observability) after §1; §6 (static analysis) and §7 (worked example) are independent of §4–§5; §10 (skeletons) is independent of everything except the dogfooded package's existence for its data.

### 6.3 Atomic commits, conventional commits

Match the Phase 1–4 cadence. Reference the task slug (e.g., `P5-T3`) and the package in subjects. Run `/atomic-commits` at natural breakpoints.

### 6.4 Validate as you go

After every few tasks: `openspec validate phase-5-validation-benchmark-dogfood --strict`. After scaffolding: `pnpm typecheck` + `pnpm build` + `pnpm test` from root — **and verify the seeded-violations package is excluded from the build** (its code is deliberately broken; if `pnpm build` compiles it, the exclusion is wrong). Treat any failure as stop-the-line.

### 6.5 The hardest tasks (re-read the docs for these)

- **4.2 + 4.3** — Pre-registration mechanics. The calibration writes provenance; the audit refuses on absent/unfrozen/overlapping. Get the refusal paths right FIRST (they're zero-model and cheap); the real-model calibration follows.
- **4.4 + 4.5** — The standing audit + the planted rubber-stamp variant. N≥10 × the fixture set is the most expensive test surface in v1 — correctness-gate it, and design the planted variant's prompt carefully (it must reliably produce high-similarity generic rationales).
- **3.1–3.4** — Authoring ~60 broken fixtures with marker-disciplined ground truth. This is content work with a drift guard; the marker comment ON the defect line is what keeps Axis 3 honest forever.
- **6.1** — The `S ⊄ D` fold. Conservative default means uninstrumented contributes ∅ — resist the temptation to "improve" it with heuristics; `--strict-unknowns` is the designed escape valve.
- **2.3** — The tail forwarders. The pipeline must never await a sink — if you find yourself adding a timeout to the emission path, the architecture is wrong (D4: out-of-band tailing, not in-path hooks).
- **11.1 + 11.2** — The dogfood + its evaluation script. The four thresholds are HARD; the exploratory metrics are labeled non-gating IN THE ARTIFACT. Friction feedback = ordinary reviewed commits.
- **9.1** — The per-class routing matrix. Mechanical = exactly 100% through the real hook; each other class caught by its designed layer and NOT by the wrong one.

For each: re-read the cited RFC §, the cited spec scenario(s), and the design decision. The contract is exhaustive — the answer is in the docs.

---

## 7. Phases 1–4 status (so you know where you're stepping in)

- **Phase 1** (archived 2026-06-09): 21 requirements / 7 capabilities. The constraint-language substrate: `@dusk/{test-harness, core-schema, core-parser, core-graph, core-decoration, core-index, pre-tool-use, cli}`.
- **Phase 2** (archived 2026-06-10): 36 requirements / 6 capabilities. The runtime + read-path verification: `@dusk/runtime-{orchestrator, memory, skills, tool-scope, verifier, verifier-test-double}`, `@dusk/delivery-mcp-server`. The Verifier runs on the **ambient Claude Code CLI** (`claude -p`) — no API key. `pnpm test` = deterministic suite; the correctness env-var gates real-model legs.
- **Phase 3** (archived 2026-06-10): 55 requirements / 14 capabilities. The full 9-step pipeline: 12 more `@dusk/runtime-*` packages. All trace fields reserved/populated through the pipeline paths.
- **Phase 4** (archived 2026-06-11, **board-ratified**): 31 requirements / 8 capabilities. The authoring dialog: `@dusk/runtime-author` + MCP/CLI surfaces. A four-reviewer arch board ratified six implementation deviations (24/24 votes) — the living specs carry the amendments (DraftIntent shape, payload tombstone on `dusk_resolve_livelock`, the transport-failure protocol pre-registered for ALL Phase-5+ real-model legs). **27 capabilities are canonical in `openspec/specs/`.**

**What Phase 5 adds:** `packages/runtime/benchmark`, `packages/fixtures/seeded-violations` (build-excluded), `packages/fixtures/worked-example`, the completion of `packages/runtime/observability`, the `registry` router in the existing `packages/api`, three views in the existing `packages/web`, and the CLI/slash surfaces. **Phase 5 is the only phase that touches the app packages** — additive only; their existing suites must stay green.

---

## 8. Mindset

You're implementing the phase that makes v1's claims true in the only sense that matters: measured. The audit protocol's shape is the product of two board rejections — no LLM-judge (it would re-introduce the correlation being measured), pre-registered frozen bars (calibration is never test data), N≥10, bias-annotated cohorts (no blended metrics, enforced in the artifact). The dogfood gate has teeth because the board rejected "data was collected" as a gate. If a fixture's ground truth can rot silently, Axis 3 is worthless — that's why the marker-comment drift guard fails the build. If a mirror can block the pipeline, observability becomes a reliability liability — that's why forwarders tail out-of-band. Every one of these constraints was earned; honor them.

And remember what closing this phase means: the commitment → phase coverage matrix — every polarity rule, every deterministic antecedent, every recovery-ladder level, every trace field — is delivered. **Build for right. Land the plane. This is the landing.**

---

## 9. To begin

Run:

```
/openspec-apply-change phase-5-validation-benchmark-dogfood
```

Work `tasks.md` top to bottom — **starting the dogfood window (§11.1) as early as its prerequisites allow**. Honor the determinism posture per task. Atomic commits as you go. At §11.4, verify every cohesive-landing checkbox. Then `/openspec-archive-change phase-5-validation-benchmark-dogfood`. Then **v1 is landed** — the next work is v1.x, driven by the dogfood's exploratory data and the deferral list, as new OpenSpec changes.
