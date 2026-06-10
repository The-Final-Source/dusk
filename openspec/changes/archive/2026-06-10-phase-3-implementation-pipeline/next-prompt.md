# Handoff Prompt — Implement Dusk Phase 3 (Implementation Pipeline)

> Paste this whole file as the opening prompt for a **fresh Claude Code session**. It contains everything needed to implement Phase 3 of the Dusk v9 architecture accurately. The final instruction tells you exactly how to begin.

---

## 0. Your task in one paragraph

You are implementing **Phase 3 — Implementation Pipeline** of the Dusk v9 architecture. The work is already fully specified as an **OpenSpec change** at `openspec/changes/phase-3-implementation-pipeline/` (proposal + 14 capability specs + design + a dependency-ordered 63-task list). Your job is to **build the code that satisfies that change**, working `tasks.md` top to bottom, writing the behavioral tests as you go, until Phase 3's **cohesive-landing criteria** all pass — then the change is ready to archive. **Do not redesign anything**: the architecture, the capability slicing, the decisions (D1–D14), the four-scenario smoke matrix, and the acceptance tests (P3-T1..T29 incl. T12b/T12c) are settled. This is the largest phase — it wires the full 9-step `dusk_implement` pipeline with the most board-hardened machinery in v9 (session snapshots, stuckness detector, 40-iter lifetime budget + the FULL 4-level recovery ladder, N=10 long cycle with N=2 confirmation, two-stage test satisfaction with livelock detection, pause/resume, cooperative cancel). Read the source-of-truth docs, then execute. **To begin, run `/openspec-apply-change` (target the `phase-3-implementation-pipeline` change).**

---

## 1. Mental model — what Dusk is

Dusk is a **constraint-satisfaction system for spec-driven AI development**. The endgame: humans stop reading/writing code and instead express **intents** via agent dialog; an orchestration harness turns intents into perfectly implemented, *adherent* code. Three layers:

1. **Constraint language** — **Intents** (atomic, hierarchical via slash-namespaced path) + **total code decoration**. The intent *is* the assertion; there is no separate "constraint" or "block" layer. Phase 1 shipped this layer end-to-end.
2. **Solver** — nine bounded sub-agent roles drive a 9-step request→commit pipeline. **Phase 2 shipped the spawn mechanism + 9 role files + the four-scope memory model + the read-only MCP surface + the scripted-verdict Verifier double.** **Phase 3 ships the actual 9-step pipeline that the roles execute** — every step from decomposition to atomic commit on `main` runs in Phase 3.
3. **Verifier** — multi-agent evaluation checks code against the constraints per-aspect with scoped focal+support evidence. Phase 2 shipped the Verifier procedure end-to-end at `temperature: 0`. **Phase 3 wires it into the short cycle and long cycle, and adds the two-stage test-satisfaction pre-pass on test code.**

This is the phase that turns Dusk from "verifies code" into "produces code." When this phase lands, an operator (or harness) issues `dusk_implement({request})` against a repo with pre-authored intents and gets **one atomic commit per bead on main**, with full trailers, through a short cycle that diagnoses its own stuckness early without contaminating the Verifier, a long cycle that filters Verifier flake via a confirmation pass, and a test step that refuses tests which don't actually verify their claims. Parallel beads run in isolated worktrees and merge topologically. The run can be **paused** for missing intents (resumable via `resume_token`), **partially committed** when the budget exhausts with some intents satisfied, and **cooperatively cancelled** with an honest accounting of what was cleaned vs preserved.

---

## 2. Read these first (source of truth)

Read these in order. Do not skim — these are the contract you are implementing.

1. **`openspec/changes/phase-3-implementation-pipeline/proposal.md`** — what's changing and why; lists the 12 new capabilities + the 2 modified ones; pins the cohesive-landing gate as the archival criterion.
2. **`openspec/changes/phase-3-implementation-pipeline/design.md`** — decisions D1–D14 (read all fourteen before writing code); the cross-change interface seams pinned by this phase (`ImplementCheckpoint`, `CancelResult`, `TestVerifierLivelockReport`, `TestVerdict`, recovery-ladder DuskError kinds, `DecomposerPartialState`, `CommitTrailers`); risks + mitigations; resolved open questions Q1–Q4.
3. **`openspec/changes/phase-3-implementation-pipeline/specs/`** — 14 capability spec files (12 ADDED + 2 modified/extended); 55 Requirements; 85 Scenarios. Every Scenario maps 1:1 onto a P3-T* plan test. This is the acceptance contract — your tests must produce each named scenario's outcome.
4. **`openspec/changes/phase-3-implementation-pipeline/tasks.md`** — the 63-task implementation checklist in dependency order. Each task names its acceptance (capability spec scenario + P3-T* slug) and its Vitest test plan with explicit determinism surface. Work top-to-bottom.
5. **`docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md`** — the v9 architecture spec. For Phase 3 specifically read end-to-end:
   - §2.10 (session-snapshot index + per-bead delta)
   - §3.4 (two-stage test satisfaction)
   - §3.4.1 (Test-Verifier livelock detector + `TestVerifierLivelockReport`)
   - §6.2 (Decomposer + bead DAG + file-overlap + cross-bead overlap precondition)
   - §6.3 (worktree parallel/serial decision)
   - §6.4 (short cycle: gate, Verifier loop, iter-5/15)
   - §6.4.1 (Recovery Ladder — **all four levels**, including L4's correct trigger)
   - §6.4.2 (stuckness detector)
   - §6.5 (long cycle: universe, N=10, N=2 confirmation pass)
   - §6.6 (Test Runner + two-stage satisfaction)
   - §6.7 (atomic commit + full v9 trailer set)
   - §6.8 (topological rebase + Conflict Resolver)
   - §6.9 (return summary)
   - §10.1.1 (pause/resume via disk checkpoint + `resume_token`)
   - §10.1.2 (`dusk_cancel` cooperative semantics)
   - Appendix A.5 (`TestVerdict`), A.7 (commit trailers), A.11 (DuskError + `CancelResult`), App. D.3 (N=10 default), D.8 (id formats)
6. **`docs/rfcs/001-mvp-rfc/intent-architecture-roadmap.md`** — Sprints 5-7 are this phase (sequential per the roadmap). The architectural commitments table at the top is the v1 scope checklist.
7. **`docs/rfcs/001-mvp-rfc/v9-implementation-plan.md`** Phase 3 (lines 383–600) — the plan section. The P3-T* test slugs come from here. **Re-read the four-scenario phase-landing smoke matrix (Primary + Variant A/B/C) and the Cohesive landing criteria checklist before you start; these are what you're driving toward.**
8. **`openspec/specs/`** — Phase 1 + Phase 2's archived specs, now the canonical baseline. You are extending two (`mcp-read-surface`, `dusk-cli-substrate`) and binding to many (`intent-schema`, `intent-parser`, `intent-graph`, `decoration-parser`, `derived-index`, `pretooluse-gate`, `sub-agent-runtime`, `memory-materialization`, `verifier-procedure`, `verifier-test-double`). **Do not modify Phase 1 or Phase 2 spec requirements** — bind to them.
9. **`openspec/changes/archive/2026-06-09-phase-1-substrate/design.md`** — Phase 1's pinned interface seams. Schema types, decoration record, derived-index query interface (Phase 3 swaps the backing store to snapshot+delta per the Phase-1 D6 contract — *signatures unchanged*), `Rejection`/`HookInput`/`HookOutput`, `dusk.config.yml` shape, test harness.
10. **`openspec/changes/archive/2026-06-10-phase-2-runtime-verification/design.md`** — Phase 2's pinned interface seams. `SubAgentTrace`, `Verdict`, `VerifierFactory`, `VerifierFixtureScript`, `spawnSubAgent({verifierFactory?})`, bead memory + `compact()`, `ModelClient`, `DuskError`, `dusk_inspect` shape. **Phase 3 consumes every one of these without reshaping.**
11. **`openspec/config.yaml`** — the version-free OpenSpec config grounding every artifact in the v9 architecture + the per-phase delivery model. **One OpenSpec change per phase, non-negotiable.**
12. **`CLAUDE.md`** at the repo root — project conventions you must follow: TypeScript strict ESM, pnpm workspaces + Turborepo, `@dusk/*` package namespace, Vitest, Drizzle ORM, functional-first, Zod as the source of truth for types, named exports only, `type` over `interface`, Result objects internally, factory functions over classes, config via injection, files < 500 lines, colocated tests.

---

## 3. The contract (don't soften it)

### What ships in Phase 3

An operator (or harness) can issue `dusk_implement({request})` against a repo with pre-authored intents and get **one atomic commit per bead on main**, each carrying full intent/test/verdict trailers, produced through a short cycle that diagnoses its own stuckness early without ever contaminating the Verifier, a long cycle that catches regressions at N=10 while filtering Verifier flake via a confirmation pass, and a test step that refuses tests which don't actually verify their claims. Parallel beads run in isolated worktrees and merge topologically. The run can be paused for missing intents (resumable via `resume_token`), partially committed when the budget exhausts with some intents satisfied, frozen for manual fix when the proposal can't be generated, and cooperatively cancelled with an honest accounting of what was cleaned vs preserved.

### What "ALL of v1" means for Phase 3

Every commitment listed in `tasks.md` and `specs/` ships in this change. No carry-over to Phase 4 except what is **explicitly** named as a Phase-4 surface in the proposal's "Non-Goals" + design Q4 resolution. Specifically Phase 3 must deliver:

- **Session-snapshot index** built once at pipeline entry, immutable for the run, hashed onto every trace as `index_snapshot_id`; per-bead in-memory delta visible only to that bead.
- **Decomposer (Step 1)** walking typed `relates_to` (all five kinds including the `sibling` negative — no auto-expand), auto-adding test-pyramid children, escalating unresolved intents with a disk checkpoint.
- **Bead DAG (Step 2)** with three orthogonal edge sources: typed-dependency + file-overlap + cross-bead claim-overlap precondition (focal=hard refusal `decomposer_bead_conflict`, support=advisory warning). Conflict detection BEFORE any worktree exists.
- **Worktrees (Step 3)** with parallel/serial decision per the DAG; `git worktree add -b dusk/<bead-id> <path> origin/main`; orphan reaping via `dusk doctor --cleanup-worktrees`.
- **Short cycle (Step 4)** — Engineer ↔ fresh Verifier loop; stuckness detector (3-iter window) firing diagnosis as early as iter 3; iter-5 fallback; iter-15 early escalation; per-entry ceiling + 40-iter bead lifetime budget; **`support_quality: low_confidence` does NOT trigger re-draft** (the verdict-split loop consequence — Fowler's contrarian gap from round 4); gate-fail loopback emits no Verifier call on blocked drafts.
- **Recovery Ladder (Step 4, on budget exhaustion)** — **ALL FOUR LEVELS**: L1 partial commit (`Partial: true` + `Deferred-Intent` trailers + `deferred.yaml`); L2 intent-modification proposal aggregating all lifetime diagnoses → `intent-proposal.yaml` + `DuskError{kind:"bead_intent_revision_needed", recoverable:true}`; L3 operator-actionable freeze → `freeze-state.md` + worktree preserved + `DuskError{kind:"bead_frozen", recoverable:false}` + `dusk implement --resume`; L4 hard abort firing **ONLY** when L3 freeze cannot serialize (NOT for "nothing satisfiable" — the round-4 fix).
- **Long cycle (Step 5)** — affected universe = direct ∪ adjacent (1-hop, snapshot-only); N=10 shuffle sharding; **N=2 confirmation pass on first reject** with `confirmation_of_trace_id`; `confirmed_reject` re-enters Step 4; `flaky_verdict_dismissed` continues sampling.
- **Test execution (Step 6)** — **Two-stage satisfaction**: Verifier pre-pass on test bodies excludes unverified tests from the Vitest invocation entirely; real `pnpm vitest run` subprocess with JSON reporter; `TestVerdict` per App. A.5.
- **Livelock detection (Step 6)** — 3-condition detector (same triple ≥3 iters + slot-focus ≥80% + ≥3 distinct taxonomy approaches) emitting `TestVerifierLivelockReport`; `dusk_resolve_livelock` with three verbs `accept_test_as_is` / `modify_triple` / `escalate`; **livelock takes precedence over budget exhaustion** when both fire on the same iteration.
- **Atomic commit (Step 7)** — Conventional Commits + full v9 trailer set in fixed App. A.7 order; conditional trailers (`Partial`, `Deferred-Intent`, `Verifier-bypassed-test-intent`, `Test-Verdict-id`) ONLY on gated paths.
- **Worktree merge (Step 8)** — topological rebase; `Partial: true`-aware drift detection; decorator-aware Conflict Resolver preferring more-specific decoration with equal-specificity ties as TODOs.
- **Return summary (Step 9)** — `{commits[], beads_summary[], intents_touched[], test_intents_executed[], trace_ids[], total_duration_ms, total_cost_usd}`.
- **Pause/resume** — disk checkpoint at `.ia/runtime/implement/<resume_token>.json` with the **frozen RFC §10.1.1 field set** (cross-proposal interface — Phase 4 consumes it); `dusk_implement({resume_token})` overload; single-use; 24h TTL with `dusk doctor --gc-implement-checkpoints`.
- **Cooperative cancel** — `dusk_cancel` flag-and-drain (no Task abort exists); ordered cleanup; `CancelResult` distinguishing `cancelled[]` from `preserved[]` (worktrees with commits stay; already-merged work stays).
- **CLI + MCP** — `dusk_implement({request? | resume_token?, scope_hint?})`, `dusk_cancel`, `dusk_resolve_livelock`, `/dusk-test`; `dusk implement` + `dusk implement --resume` CLI mirrors; `dusk doctor --cleanup-worktrees` / `--gc-implement-checkpoints` / `--gc-dialogs`.

### Non-goals (do NOT introduce)

These are Phase 4/5 contracts. Building any of them now leaks scope and breaks the per-phase delivery model:

- Author 5-stage dialog flow, Stage 4.5 validations, dialog persistence. **L2's recovery *action* (`dusk_author_continue` consumption of `intent-proposal.yaml`) is Phase 4.** L2's *artifact* (the yaml + the recoverable error contract) ships here.
- The `dusk_resolve_livelock({verb: "modify_triple"})` flow consuming the inline payload is Phase 3; rewiring it to a `dusk_author_continue` dialog continuation pattern is Phase 4 (design Q4).
- Fresh-Verifier audit, `/dusk-doctor --static-analysis`, observability sinks, benchmark harness, seeded-violations fixture, dogfooding. Phase 5.
- App-package code (`packages/{api,web,shared,hooks,mobile}`) — untouched (Phase-5 dogfood targets).
- Reshaping any Phase-1 or Phase-2 capability. Phase 3 binds to those interfaces; it does not modify their behavior.

---

## 4. Build philosophy — HARD constraints (do not soften)

### 4.1 Build the RIGHT thing the RIGHT way

No deference. No shortcuts. No `// TODO: Phase 4 will wire this`. Assume infinite resources, runway, scope. The phase ships **whole** — every behavioral test passes, every cohesive-landing checkbox is true, then the change archives.

### 4.2 Khorikov classical / behavior-focused testing

Same as Phase 2:
- **Test observable behavior, not implementation.** A refactor that preserves behavior must not break a test.
- **Real dependencies first.** Real git (real `git worktree add/remove`, real rebase), real Vitest (`pnpm vitest run --reporter=json`), real fs, real MCP server, real frontier-model LLM for verdict-correctness tests. No mocks of internal modules.
- **Mocks only for unmanaged dependencies.** The only substitute is the Phase-2 scripted-verdict Verifier double — and only for the **subset of tests that exercise control flow** (snapshot coherence, gate-fail loopback, stuckness detector, iter-5/15, recovery ladder L1–L4, confirmation-pass mechanism, livelock detection mechanics, cancel drain).
- **Each test asserts one unit of behavior.** Not "this function returns this value" — "this user-observable outcome holds when this trigger happens."
- **Wiring/scaffolding does not need testing.** Type declarations, barrel exports, Turbo config, package scaffolding — skip.
- **Resistance to refactoring.** Tests that break on internal API renames are a liability.

### 4.3 Determinism testing posture (per the round-4 board)

Phase 3 has the largest test split so far. Use the right surface for each task — `tasks.md` names which.

- **Control-flow / orchestration tests** run **zero-model** via the Phase-2 scripted-verdict Verifier double (`packages/runtime/verifier-test-double`). Injected via the `verifierFactory?` parameter on `spawnSubAgent`. **`N=1` is sufficient** — these are deterministic. Use them for:
  - Snapshot coherence (P3-T1)
  - Decomposer logic (P3-T2/T3/T4/T5)
  - Pause/resume (P3-T5/T6/T7)
  - Worktree decisions (P3-T23)
  - Gate-fail loopback (P3-T24)
  - Stuckness detector structural firing (P3-T8 first leg)
  - Iter-5/iter-15 fallbacks (P3-T9/T10)
  - All four Recovery Ladder levels (P3-T11/T12/T12b/T12c)
  - Per-entry vs lifetime budget mechanics (P3-T25)
  - Long-cycle confirmation-pass mechanism (P3-T14/T15) — **P3-T15 dismissal CANNOT be tested against a real model** (a real frontier model can't be coerced to reject-then-accept-twice on demand); the *orchestration* is the unit under test.
  - Long-cycle universe construction (P3-T26)
  - Livelock detection mechanics + three-verb resolution (P3-T18/T28)
  - Two-stage satisfaction Verifier-pre-pass exclusion (P3-T16)
  - Commit-trailer assembly (P3-T19)
  - Topological merge + Conflict Resolver (P3-T20)
  - Step 9 summary (P3-T21)
  - Cancel partitioning (P3-T22)
  - Verdict-split loop consequence — low-confidence does not burn iter (P3-T29)

- **Verdict-correctness + smoke-primary tests** run against the **real frontier model** at `temperature: 0` with the pre-registered protocol **`N=3` independent invocations per assertion, threshold ≥2/3 producing the documented structural outcome**. Use them for:
  - **P3-T8 second leg** — the integration leg deriving `failing_triple_set` from real verdicts on a genuinely-stalling fixture (proves the upstream wire, not just the predicate).
  - **P3-T17** — Verifier pre-pass + real Vitest invocation on real test code producing a satisfied `TestVerdict`.
  - **P3-T27** — `/dusk-test` standalone over a scope with verified tests.
  - **14.4 — `dusk implement` CLI smoke** over a small fixture-request.
  - **15.3 Primary scenario** — the four-scenario smoke matrix's happy path.

- **Unit-only tests** are restricted to two pure transforms with no I/O:
  - `1.2` — schema validation tests over the core-schema seam types.
  - `7.1` — the Recovery Ladder decision function (enumerate the 2^3 = 8 input combinations).

If a task in `tasks.md` doesn't name the determinism surface, default to integration-against-real-deps. Never reach for a mock to avoid wiring complexity.

### 4.4 Phase ships whole — cohesive landing is the archival gate

When you think you're done, run §15.4 of `tasks.md` against reality. Every box must be true:

- All P3-T1..T29 (incl. T12b, T12c) green vs real dependencies.
- The four-scenario smoke matrix (Primary + Variant A/B/C in `tasks.md` §15.3) all green.
- `dusk_implement` / `dusk_cancel` / `dusk_resolve_livelock` / `/dusk-test` / `dusk implement --resume` / CLI mirror operable; `--help` works on each new command.
- No carry-over: Steps 1–9 all run for real; **all four Recovery Ladder levels fire** (L2's author-driven recovery *action* lands in Phase 4, but its *artifact* + *error contract* ship here); long cycle is N=10 with confirmation pass; two-stage tests + livelock are live.
- Asymmetry guarantee mechanically checked in-run: no iteration-specific content in Verifier `raw_prompt`; diagnosis present only on Bead-Orchestrator traces.
- `openspec validate phase-3-implementation-pipeline --strict` passes.

Then archive via `/openspec-archive-change phase-3-implementation-pipeline`.

---

## 5. Cross-change interface seams

### 5.1 Phase 1 + Phase 2 seams — Phase 3 BINDS, never reshapes

These shapes are frozen by Phase 1 + Phase 2's archived `design.md`. Bind to them; do not reshape them:

- **Schema types** — `Intent`, `Triple` (affirmative slots + `polarity`/`quantifier`/`scope`), `ComposeRule`, five-kind `RelatesTo`, closed-vocabulary antecedent union (Phase 1).
- **Decoration record** — `{file, line, scope, declaration_name|null, marker, intent_path, aspect_ids[]|null, support_triple|null, ignore_clause|null}` (Phase 1).
- **Derived-index query interface** — forward / reverse / focal+support / aspect-rollup / test-discovery + hierarchical satisfaction. **Phase 3 swaps the backing store** (snapshot + delta) **without changing the signatures**. This is the Phase-1 D6 contract.
- **`Rejection` union + `HookInput`/`HookOutput`** — Phase 1 PreToolUse contract.
- **`dusk.config.yml` shape** — Phase 3 reads `sanity.short_cycle_max_iterations`, `sanity.bead_lifetime_iterations`, `sanity.long_cycle_round_count`, `sanity.stuckness_detector_window`, `models.default`/`models.overrides`. No additions to the outer shape.
- **Test harness** — Phase 1 temp-repo factory + real-hook invoker + injectable `Clock`; Phase 2 trace-stream tail reader + `raw_prompt` matchers + `VerifierFixtureScript` + `scriptedVerdictFactory`. Phase 3 extends with `MockGitWorktree`, `MockClock` advance helper, stalling-fixture builder, scripted Vitest reporter stub.
- **`SubAgentTrace`** (Phase 2) — Phase 3 populates the reserved fields (`index_snapshot_id`, `stuckness_detector_state`, `verifier_livelock_signal`, `confirmation_of_trace_id`, `confirmation_pass_outcome`) that Phase 2 reserved.
- **`Verdict`** (Phase 2) — Phase 3 consumes the focal_verdict/support_quality split; the short cycle's re-draft logic gates on `focal_verdict: fail` only (the P3-T29 verdict-split loop consequence).
- **`VerifierFactory` + `spawnSubAgent({verifierFactory?})`** (Phase 2) — Phase 3 uses the injected factory for every control-flow test.
- **Bead memory format + `compact()`** (Phase 2) — Phase 3 writes the `## Current diagnosis` section here (and only here — never into a Verifier spawn payload).
- **`ModelClient`** (Phase 2 ambient Claude Code) — Phase 3 uses it for verdict-correctness legs.
- **`DuskError` envelope** (Phase 2) — Phase 3 adds new kinds (see §5.2).
- **`dusk_inspect` shape** (Phase 2) — Phase 3 populates `low_confidence_supports[]` from in-run verdicts but does not alter the shape.

### 5.2 Phase 3 PINS new seams in `@dusk/core-schema` — Phase 4 + Phase 5 consume

Per design D14:

- **`ImplementCheckpoint`** — the frozen RFC §10.1.1 field set. Phase 4 imports + enriches `suggested_dialog_seed` *content* without changing the *shape*.
- **`CancelResult`** — per RFC App. A.11. Phase 5 audit reads it.
- **`TestVerifierLivelockReport`** — per RFC §3.4.1. Phase 4 rewires `modify_triple` to a `dusk_author_continue` flow; the report shape is stable.
- **`TestVerdict`** — per RFC App. A.5. Phase 5 audit aggregates over it.
- **`DecomposerPartialState`** — opaque-to-Phase-4 inside the checkpoint; round-tripped verbatim.
- **`CommitTrailers`** — the full v9 trailer set as a typed structure; Phase 5 audit reads it.
- **DuskError additions** — `bead_intent_revision_needed`, `bead_frozen`, `bead_aborted`, `decomposer_bead_conflict`, `implement_paused_for_authoring`, `implement_resume_token_expired`, `cancellation_already_committed` (Phase 2 pinned the first three of those; Phase 3 adds the remainder).

Place every new schema in `@dusk/core-schema` (NOT in `runtime/*` packages). This keeps the dep graph acyclic — Phase 4's `runtime/author` will need to import the checkpoint shape, and a runtime→runtime dep would cycle the graph. The same lesson Phase 2 learned with `SubAgentTrace`/`Verdict`/`VerifierFactory`.

---

## 6. Implementation approach — how to actually do this

### 6.1 Use `/openspec-apply-change`

Don't try to free-implement from memory. The flow is:

```
/openspec-apply-change phase-3-implementation-pipeline
```

This walks `tasks.md` top-to-bottom. For each task, you implement the code, write the named test, run it against real dependencies (or the double per the determinism posture), and check the box. Atomic conventional commits per task (or per small task group) — Phase 2 produced ~15 commits across 45 tasks; Phase 3's 63 tasks should produce 25-45 commits.

### 6.2 Respect dependency order (and the safe parallelism)

`tasks.md` is ordered by dependency. Don't skip ahead. The safe forks:

- §3 (`implement-checkpoint`) and §4 (`worktree-orchestration`) are independent infra — can be worked in parallel after §1 + §2 land.
- §5 (`bead-decomposition`) binds §2 + §3 + §4.
- §6 (`short-cycle`) binds §2; §7 (`recovery-ladder`) is consumed by §6 at budget exhaustion. §7.1 (the pure decision function) can land in parallel with §6 — it has no deps beyond core-schema.
- §8, §9, §10 (long cycle / test execution / livelock) all follow §6. They can be worked in parallel after §6.
- §11 (`commit-merge`) follows §10.
- §12 (`cooperative-cancel`) is orthogonal — can be worked in parallel with any of §6-§11 after §1 + §2 land.
- §13 (`implement-write-surface`) wires §1-§12 into the MCP tool. Must be sequential after §6-§11.
- §14 (MCP read populated + CLI mirrors) follows §13.
- §15 (smoke + cohesive landing) is last.

### 6.3 Atomic commits, conventional commits

Match Phase 1+2's commit cadence: small, focused, conventional-commits formatted. Use `chore:`/`feat:`/`refactor:`/`test:`/`docs:` prefixes; reference the task slug (e.g., `P3-T11`) and the package in the subject line where useful. Run the `/atomic-commits` skill at natural breakpoints.

### 6.4 Validate as you go

After every few tasks: `openspec validate phase-3-implementation-pipeline --strict`. After the package scaffolding lands: `pnpm typecheck` + `pnpm build` + `pnpm test` from repo root. Treat any failure as a stop-the-line — don't accumulate broken state.

### 6.5 The hardest tasks (re-read the docs for these)

- **2.2** — the layered query model. The Phase-1 D6 contract must hold; cross-bead and same-bead queries diverge only at the visibility layer, not at the signature.
- **5.2** — Bead DAG construction with three orthogonal edge sources. Failing precondition aborts BEFORE any `git worktree add`. P3-T4 (focal hard / support warning) is the most subtle.
- **6.3 + 6.4** — Stuckness detector. The predicate is a pure function (6.3); the derivation leg (6.4) requires a real frontier model + a fixture you've genuinely engineered to stall.
- **7.1** — Recovery Ladder decision function. Enumerate the 8 input combinations. The L4 trigger is **specifically** "L3 freeze cannot serialize" — NOT "nothing satisfiable" (round-4 fix; P3-T12c pins this).
- **8.3** — N=2 confirmation pass. Three test scenarios (confirm, dismiss, no-second-pass) all driven by the scripted-verdict double.
- **9.1 + 9.2** — Two-stage satisfaction. The Verifier pre-pass EXCLUDES failed tests from the Vitest invocation argv; assertion is on what `pnpm vitest` is called with.
- **10.1 + 10.2** — Livelock detection mechanics + three-verb resolution. Three sub-tests per verb.
- **11.4** — Decorator-aware Conflict Resolver. More-specific wins; equal-specificity → TODO markers.
- **15.3** — The four-scenario smoke matrix. This is what proves the phase ships whole.

For each: re-read the cited RFC §, re-read the cited spec scenario(s), look at Phase 2's archive for analogous patterns. The contract is exhaustive — the answer is in the docs.

---

## 7. Phase 1 + Phase 2 status (so you know where you're stepping in)

### Phase 1 (archived `openspec/changes/archive/2026-06-09-phase-1-substrate/`)

21 requirements across 7 capabilities synced into `openspec/specs/`:
- `intent-schema`, `intent-parser`, `intent-graph`, `decoration-parser`, `derived-index` — the constraint-language substrate.
- `pretooluse-gate` — the 10-check hook with 12 typed rejection kinds.
- `dusk-cli-substrate` — `dusk init` / `validate` / `inspect` (raw) / `doctor --check-hook [--repair]`.

Phase 1 packages on `main`: `@dusk/test-harness`, `@dusk/core-schema`, `@dusk/core-parser`, `@dusk/core-graph`, `@dusk/core-decoration`, `@dusk/core-index`, `@dusk/pre-tool-use`, `@dusk/cli`.

### Phase 2 (archived `openspec/changes/archive/2026-06-10-phase-2-runtime-verification/`)

36 requirements across 5 ADDED + 1 ADDED-delta capabilities synced into `openspec/specs/`:
- `sub-agent-runtime`, `memory-materialization`, `verifier-procedure`, `mcp-read-surface`, `verifier-test-double` — the runtime substrate + read-path verification.
- `dusk-cli-substrate` (extended) — `dusk verify` / `inspect` (extended) / `roles` / `skills`.

Phase 2 packages on `main`: `@dusk/runtime-orchestrator`, `@dusk/runtime-memory`, `@dusk/runtime-skills`, `@dusk/runtime-tool-scope`, `@dusk/runtime-verifier`, `@dusk/runtime-verifier-test-double`, `@dusk/delivery-mcp-server`. The 9 role files + tier-1/2 skills are bundled as CLI assets installed by `dusk init`.

### What Phase 3 adds

12 new `@dusk/runtime-*` packages (`decomposer`, `worktree`, `short-cycle`, `recovery-ladder`, `long-cycle`, `test-runner`, `livelock-detection`, `commit`, `merge`, `conflict-resolver`, `implement-checkpoint`, `cancel`) + extensions to `@dusk/runtime-orchestrator` (the session snapshot + Bead Orchestrator + 9-step state machine) + the `@dusk/delivery-mcp-server` extensions for `dusk_implement` / `dusk_cancel` / `dusk_resolve_livelock` / `/dusk-test` + `@dusk/cli` extensions (`dusk implement`, `dusk implement --resume`, `dusk doctor --cleanup-worktrees` / `--gc-implement-checkpoints` / `--gc-dialogs`).

### Critical Phase 2 reminder

The Verifier runs on the **ambient Claude Code CLI** (`claude -p`, ambient auth) — **no `ANTHROPIC_API_KEY` required** (RFC §9.9). `claudeCodeModelClient` is the default; the Anthropic SDK client is an alternative. Phase 3's verdict-correctness legs (P3-T8 derivation, P3-T17, P3-T27, 14.4, 15.3 Primary) use the ambient path. Run them via `pnpm test:correctness`; the deterministic suite via `pnpm test`.

---

## 8. Mindset

You're implementing the phase that turns Dusk from "verifies code" into "produces code." When this phase lands, the v9 architecture is real for the first time — Steps 1 through 9 run end-to-end and `dusk_implement` produces atomic commits on `main`. The board-hardened control machinery (snapshot coherence, stuckness detector + iter-5/15, the four-level recovery ladder with the corrected L4 trigger, N=10 long cycle with N=2 confirmation, two-stage tests with livelock detection, pause/resume, cooperative cancel) was designed exhaustively across three review rounds; your job is to build it, not redesign it. Every test in `specs/` is a property that must hold. Every decision in `design.md` was made for a reason; if you find a reason it's wrong, surface it before you change it — don't silently deviate. Phase 4's Author flow plugs into the pause/resume contract you ship here. Phase 5's audit measures everything you produce here.

The contract is exhaustive. The contract is the document set you just read. The contract has zero deferral except where the proposal explicitly defers.

**Build for right. Land the plane.**

---

## 9. To begin

Run:

```
/openspec-apply-change phase-3-implementation-pipeline
```

Work `tasks.md` top to bottom. Honor the determinism testing protocol per task. Atomic commits as you go. At §15.4, verify every cohesive-landing checkbox. Then `/openspec-archive-change phase-3-implementation-pipeline`. Then you're done with Phase 3; Phase 4 (Intent Authoring — Author dialog flow, replacing the L2 + `modify_triple` stubs with real Author continuations) is the next change.
