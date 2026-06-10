# Handoff Prompt — Implement Dusk Phase 2 (Runtime + Read-Path Verification)

> Paste this whole file as the opening prompt for a **fresh Claude Code session**. It contains everything needed to implement Phase 2 of the Dusk v9 architecture accurately. The final instruction tells you exactly how to begin.

---

## 0. Your task in one paragraph

You are implementing **Phase 2 — Runtime + Read-Path Verification** of the Dusk v9 architecture. The work is already fully specified as an **OpenSpec change** at `openspec/changes/phase-2-runtime-verification/` (proposal + 6 capability specs + design + a dependency-ordered 45-task list). Your job is to **build the code that satisfies that change**, working `tasks.md` top to bottom, writing the behavioral tests as you go, until Phase 2's **cohesive-landing criteria** all pass — then the change is ready to archive. **Do not redesign anything**: the architecture, the capability slicing, the decisions (D1–D12), and the acceptance tests (P2-T1..T20 incl. T6b/T6c/T7b/T15b/T15c) are settled. Phase 2 is the first phase where a model enters the loop — so this is where the Verifier's load-bearing properties (polarity inversion, deterministic antecedents, verdict split, scoped reading) become real and falsifiable. Read the source-of-truth docs, then execute. **To begin, run `/openspec-apply-change` (target the `phase-2-runtime-verification` change).**

---

## 1. Mental model — what Dusk is

Dusk is a **constraint-satisfaction system for spec-driven AI development**. The endgame: humans stop reading/writing code and instead express **intents** via agent dialog; an orchestration harness turns intents into perfectly implemented, *adherent* code. Three layers:

1. **Constraint language** — **Intents** (atomic, hierarchical via slash-namespaced path) + **total code decoration**. The intent *is* the assertion; there is no separate "constraint" or "block" layer. Phase 1 shipped this layer end-to-end.
2. **Solver** — nine bounded sub-agent roles drive a 9-step request→commit pipeline. **Phase 2 ships the spawn mechanism + 9 role files + the four-scope memory model + the read-only MCP surface.** The pipeline itself is Phase 3.
3. **Verifier** — multi-agent evaluation checks code against the constraints per-aspect with scoped focal+support evidence. **Phase 2 ships the Verifier procedure end-to-end at `temperature: 0`** — polarity inversion at runtime, deterministic index-lookup antecedents for `compose: implies`, the focal_verdict + support_quality split with per-claim triple_verdict, and the scripted-verdict double that Phase-3 control-flow tests will bind to.

This is the phase where the **load-bearing v9 properties become falsifiable**: the LLM never sees negation; an `implies` antecedent costs zero tokens when it's false; a wrong support triple lowers `support_quality` but does not by itself fail the focal claim; the Verifier reads ~4 lines per aspect, not the whole function body; the Engineer's convergence diagnosis is **structurally absent** from every Verifier spawn payload.

---

## 2. Read these first (source of truth)

Read these in order. Do not skim — these are the contract you are implementing.

1. **`openspec/changes/phase-2-runtime-verification/proposal.md`** — what's changing and why; lists the new capabilities + the modified one; pins the cohesive-landing gate as the archival criterion.
2. **`openspec/changes/phase-2-runtime-verification/design.md`** — decisions D1–D12 (read all twelve before writing code); the cross-change interface seams pinned by this phase (`SubAgentTrace` field set, `Verdict` shape, bead-memory file format, Verifier-double seam, `DuskError` envelope additions, `dusk_inspect` response shape); risks + mitigations; resolved open questions Q1–Q3.
3. **`openspec/changes/phase-2-runtime-verification/specs/`** — 6 capability spec files; 36 Requirements; 54 Scenarios. Every Scenario maps 1:1 onto a P2-T* plan test. This is the acceptance contract — your tests must produce each named scenario's outcome.
4. **`openspec/changes/phase-2-runtime-verification/tasks.md`** — the 45-task implementation checklist in dependency order. Each task names its acceptance (capability spec scenario + P2-T* slug) and its Vitest test plan. Work top-to-bottom; respect the parallelism notes (§3 memory and §4 verifier-test-double once §2 lands; §6 MCP once §5 lands).
5. **`docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md`** — the v9 architecture spec. For Phase 2 specifically read end-to-end:
   - §3.1 / §3.1.1 (polarity field + matrix/constituent parser — Phase 1 enforces these; Phase 2 honors them in the Verifier prompt)
   - §3.2 / §3.2.1 (`compose: implies` with deterministic antecedents — closed predicate vocabulary, index lookup, no LLM call when antecedent false)
   - §3.3 (Verifier procedure — the §3.3 steps are the spec for `verifier-procedure`)
   - §6.4 + App. A.6 note (diagnosis routes to Bead Orchestrator only — the structural no-leak rule Phase 2 must enforce)
   - §9.1, §9.5 (role file format + the Verifier prompt template's two-path structure)
   - §9.4 / §9.7 (advisory tool/skill scoping in v1)
   - §9.6 / §9.6.1 (memory scopes + dual-channel bead memory + mechanical compaction)
   - §9.9 (sub-agent spawn mechanism via Claude Code's Task tool)
   - §10.1 (MCP read surface: tools + resources + uniform DuskError envelope)
   - Appendix A.4 (Verdict shape), A.6 (SubAgentTrace), A.9 (role frontmatter), A.11 (DuskError envelope)
   - Appendix B (the worked example — your phase-landing smoke test verifies this end-to-end)
6. **`docs/rfcs/001-mvp-rfc/intent-architecture-roadmap.md`** — Sprints 3-4 are this phase. The architectural commitments table at the top is the v1 scope checklist.
7. **`docs/rfcs/001-mvp-rfc/v9-implementation-plan.md`** Phase 2 (~lines 211–380) — the plan section. The P2-T* test slugs come from here. Re-read the **Phase-landing smoke test** scenario and the **Cohesive landing criteria** checklist before you start; these are what you're driving toward.
8. **`openspec/specs/`** — Phase 1's archived specs, now the canonical baseline. You are extending these (`dusk-cli-substrate`) and binding to them (`derived-index` query interface, `intent-schema` types, the `Rejection`/`HookInput`/`HookOutput` contract, `dusk.config.yml` shape). **Do not modify Phase 1 spec requirements** — bind to them.
9. **`openspec/changes/archive/2026-06-09-phase-1-substrate/design.md`** — the cross-change interface seams pinned at the end. These are frozen contracts. Your code consumes them; you do not reshape them.
10. **`openspec/config.yaml`** — the version-free OpenSpec config grounding every artifact in the v9 architecture + the per-phase delivery model. **One OpenSpec change per phase, non-negotiable.**
11. **`CLAUDE.md`** at the repo root — project conventions you must follow: TypeScript strict ESM, pnpm workspaces + Turborepo, `@dusk/*` package namespace, Vitest, Drizzle ORM, functional-first, Zod as the source of truth for types, named exports only, `type` over `interface`, Result objects internally, factory functions over classes, config via injection, files < 500 lines, colocated tests.

---

## 3. The contract (don't soften it)

### What ships in Phase 2

A `dusk_verify` call against a decorated diff or scope returns **accurate per-triple verdicts that split focal correctness from support-decoration quality**, correctly **rejects negative-polarity triples whose affirmative claim holds** (with the LLM never seeing negation), and **trivially accepts `compose: implies` intents whose antecedent is false without spending a single token on the consequent**. `dusk_inspect` reports hierarchical satisfaction + focal/support claim lists + low-confidence supports. All nine sub-agent roles spawn via Claude Code's Task tool with Dusk-materialized memory and skills. The Verifier is **provably fresh per call** — its spawn payload is structurally identical across iterations, carries no diagnosis content, and the test-mode `raw_prompt` capture is the observable surface that proves it.

### What "ALL of v1" means for Phase 2

Every commitment listed in `tasks.md` and `specs/` ships in this change. No carry-over to Phase 3 except what is **explicitly** named as a Phase-3 surface in the proposal's "Non-Goals" + "Impact" sections. Specifically Phase 2 must deliver:

- Nine v9 role files with complete bodies (including the complete `dusk-verifier.md` template with 2 positive + 2 negative few-shots drawn from RFC App. B).
- The 8 tier-1 skills shipped complete (`verifier/{triple-evaluation, code-span-scoping, polarity-aware-evaluation, implies-evaluation}`, `engineer/{decoration-completeness, statement-extraction}`, `author/{polarity-decision, implies-antecedent-grammar}`).
- `spawnSubAgent` three-stage assembler (memory → skills → assemble → Task call) with `dusk_role_version` enforcement, `SubAgentTrace` emission with `skills_loaded[]` + `iteration_number?` + the test/benchmark-only `raw_prompt` (with redaction).
- Memory materialization for all four scopes + the structured dual-channel bead memory format + the deterministic mechanical `compact()` transform + the **diagnosis-routing structural guarantee** (the Verifier's `memory: none` rendering ignores any populated bead memory).
- The Verifier procedure end-to-end at `temperature: 0`: scoped focal+support evidence reading; deterministic antecedent evaluation for all three closed predicates (`is decorated with`, `claims any aspect of`, `is enclosed by a decoration of`) including the negative-polarity (set-complement) case; **ambiguous antecedent → typed structural error, never an LLM fallback**; affirmative-only prompt with quantifier+scope; runtime polarity inversion; per-claim `triple_verdict` extraction; `support_quality` aggregation; `compose` aggregation (all/any/none/implies); `support_pass_count` summary.
- MCP read-only surface: `dusk_status` / `dusk_inspect` / `dusk_verify` + the six paired list/get tools + equivalent MCP resources + uniform `DuskError` envelope.
- The scripted-verdict Verifier double (Phase 1's deferred design D7) — the test seam Phase 3 control-flow tests bind to.
- CLI extensions: `dusk verify`, extended `dusk inspect`, `dusk roles`, `dusk skills`, each with working `--help`.

### Non-goals (do NOT introduce)

These are Phase 3/4/5 contracts. Building any of them now leaks scope and breaks the per-phase delivery model:

- Pipeline-side machinery: Decomposer, worktrees, short cycle, long cycle, Test Runner, livelock detection, recovery ladder, commit, merge, `dusk_cancel`, pause/resume / `resume_token`, session snapshot (`index_snapshot_id` is reserved-but-optional in Phase 2 traces).
- Author 5-stage dialog flow, Stage 4.5 validations, dialog persistence.
- Fresh-Verifier audit, static-analysis doctor, observability sinks, benchmark harness, dogfooding.
- App-package code (`packages/{api,web,shared,hooks,mobile}`) — untouched (Phase-5 dogfood targets).

---

## 4. Build philosophy — HARD constraints (do not soften)

### 4.1 Build the RIGHT thing the RIGHT way

No deference. No shortcuts. No `// TODO: Phase 3 will wire this`. Assume infinite resources, runway, scope. The phase ships **whole** — every behavioral test passes, every cohesive-landing checkbox is true, then the change archives.

### 4.2 Khorikov classical / behavior-focused testing

The tests are integration-style by default against real dependencies:

- **Test observable behavior, not implementation.** Tests assert the OUTCOME (what a verdict says, what bytes go into `raw_prompt`, what `dusk_inspect` returns), not the call sequence. A refactor that preserves behavior must not break a test.
- **Real dependencies first.** Real file system (use `@dusk/test-harness`'s temp-repo factory), real MCP server (in-process), real frontier-model LLM for verdict-correctness tests. The PreToolUse hook from Phase 1 is real (real-hook invoker). No mocks of internal modules — internal modules are managed dependencies and you test against them directly.
- **Mocks only for unmanaged dependencies.** The Anthropic API is the *managed* dependency for verdict-correctness tests (use real calls with `temperature: 0`). The *only* substitute is the scripted-verdict Verifier double — and that's for the **subset of tests that exercise control flow** (spawn pipeline, memory, asymmetry, compaction, scope guards), NOT verdict correctness.
- **Each test asserts one unit of behavior.** Not "this function returns this value with these args" — "this user-observable outcome holds when this trigger happens."
- **Wiring/scaffolding does not need testing.** Type declarations, barrel exports, Turbo config, package scaffolding — skip. Test the behavior that uses them.
- **Resistance to refactoring.** A test that breaks every time a field is renamed or a module is reorganized is a liability.

### 4.3 Determinism testing posture (per the round-4 board)

Tests split cleanly into two categories. Use the right surface for each task — `tasks.md` names which.

- **Control-flow / orchestration tests** run **zero-model** via the scripted-verdict Verifier double (`packages/runtime/verifier-test-double`). The double implements the same `VerifierFactory` interface as the real Verifier; injected via the `verifierFactory?` parameter on `spawnSubAgent`. These tests are deterministic — `N=1` is sufficient. Use them for: spawn pipeline, memory materialization, dual-channel bead memory, compaction transform, asymmetry / no-leak structural assertion, the role-version refusal, the compose-aggregation truth table, the antecedent-zero-LLM-call assertion.
- **Verdict-correctness tests** run against the **real frontier model** at `temperature: 0` with the pre-registered protocol **`N=3` independent invocations per assertion, threshold ≥2/3 producing the documented structural outcome**. Use them for: polarity inversion truth-table (5.5), verdict-split focal/support orthogonality (5.6), quantifier enforcement (5.8), scoped-reading correctness (`dusk_verify` over App. B in 6.4), the `dusk verify` CLI integration (7.1), and the phase-landing smoke test (8.3).
- **Unit-only tests** are restricted to pure transforms with no I/O: the redaction allowlist (1.2), the `compact()` transform in isolation (3.3), the `support_quality` aggregation rule (5.7). Use Vitest's pure-function patterns; no temp repos.

If a task in `tasks.md` doesn't name the determinism surface, default to integration-against-real-deps. Never reach for a mock to avoid wiring complexity.

### 4.4 Phase ships whole — cohesive landing is the archival gate

When you think you're done, run §8.4 of `tasks.md` against reality. Every box must be true:

- All P2-T1..T20 (incl. T6b/T6c/T7b/T15b/T15c) green vs real dependencies.
- The phase-landing smoke test (`tasks.md` §8.3) passes.
- `dusk_verify` / `dusk_inspect` / `dusk_status` + paired tools + MCP resources are operable; CLI `--help` works on each new command.
- No carry-over: the Verifier procedure is complete (no stubbed antecedent path, no flat verdict, no LLM-judged antecedent); all 9 role files ship with real content including the Verifier template's 4 few-shots.
- Spawn audit proves `memory: none` freshness and diagnosis non-leakage; dual-channel bead memory exists with mechanical compaction; 20-iter size bound holds.
- `openspec validate phase-2-runtime-verification --strict` passes.

Then archive via `/openspec-archive-change phase-2-runtime-verification`.

---

## 5. Cross-change interface seams (Phase 1 pinned these — honor exactly)

These shapes are frozen by Phase 1's archived `design.md`. Bind to them; do not reshape them:

- **Schema types** — `Intent`, `Triple` (affirmative slots + `polarity`/`quantifier`/`scope`), `ComposeRule`, five-kind `RelatesTo`, the closed-vocabulary antecedent union. Phase 2's Verifier consumes these.
- **Decoration record** — `{ file, line, scope, declaration_name|null, marker, intent_path, aspect_ids[]|null, support_triple|null, ignore_clause|null }`. Phase 2's Verifier reads this via the index.
- **Derived-index query interface** — forward / reverse / focal+support / aspect-rollup / test-discovery + hierarchical satisfaction. Phase 2 (Verifier scoping) binds to this interface. Phase 3 will later swap the backing store (snapshot + delta) without changing the signatures — your code does not reach inside the index implementation.
- **`Rejection` union + `HookInput`/`HookOutput`** — the PreToolUse gate's contract. Phase 2 does not modify this.
- **`dusk.config.yml` shape** — `test_pyramid.suffixes`, `sanity.*`, `models.*`, `test_runner.*`. Phase 2 reads `models.default`, `models.overrides`, and adds `verifier_evidence_max_lines` (default 200) without altering the outer file shape.
- **Test harness** — temp-repo factory + real-hook invoker + injectable `Clock`. Phase 2 extends with: trace-stream tail reader, `raw_prompt` matchers, `VerifierFixtureScript` type + `scriptedVerdictFactory(fixtureScript)` shim.

Phase 2 itself pins **new** seams that Phases 3/4/5 consume — Design D-list documents them. Do not let any of those seams drift during implementation.

---

## 6. Implementation approach — how to actually do this

### 6.1 Use `/openspec-apply-change`

Don't try to free-implement from memory. The flow is:

```
/openspec-apply-change phase-2-runtime-verification
```

This walks `tasks.md` top-to-bottom. For each task, you implement the code, write the named test, run it against real dependencies (or the double per the determinism posture), and check the box. Atomic conventional commits per task (or per small task group) — Phase 1 produced ~20 commits across 25 tasks; Phase 2's 45 tasks should produce 30-50 commits.

### 6.2 Respect dependency order (and the safe parallelism)

`tasks.md` is ordered by dependency. Don't skip ahead. The safe forks:

- §3 (memory-materialization) and §4 (verifier-test-double) can be worked in parallel once §2 (spawn pipeline) lands.
- §5 (verifier-procedure) must follow §2 and §3.
- §6 (MCP) must follow §5 (it wraps `dusk_verify`).
- §7 (CLI) must follow §6.
- §8 (smoke + cohesive landing) is last.

### 6.3 Atomic commits, conventional commits

Match Phase 1's commit cadence: small, focused, conventional-commits formatted. Use `chore:`/`feat:`/`refactor:`/`test:`/`docs:` prefixes; reference the task slug (e.g., `P2-T6`) and the package in the subject line where useful. Run the `/atomic-commits` skill at natural breakpoints.

### 6.4 Validate as you go

After every few tasks: `openspec validate phase-2-runtime-verification --strict`. After the package scaffolding lands: `pnpm typecheck` + `pnpm build` + `pnpm test` from repo root. Treat any failure as a stop-the-line — don't accumulate broken state.

### 6.5 If you get stuck

The hardest tasks: 5.1 (antecedent evaluator — three closed predicates against the index), 5.4 (the affirmative prompt builder — this is what proves polarity inversion), 5.5 (real-model polarity inversion test with N=3), 5.10 (`Verdict` assembly with the full App. A.4 shape), 8.3 (the phase-landing smoke test). For each: re-read the cited RFC §, re-read the cited spec scenario, look at App. B for the canonical worked example. The contract is exhaustive — the answer is in the docs.

---

## 7. Phase 1 status (so you know where you're stepping in)

Phase 1 (substrate) is **archived** (`openspec/changes/archive/2026-06-09-phase-1-substrate/`) with 21 requirements synced into `openspec/specs/` as the canonical baseline across 7 capabilities:

- `intent-schema`, `intent-parser`, `intent-graph`, `decoration-parser`, `derived-index` — the constraint-language substrate.
- `pretooluse-gate` — the 10-check hook with 12 typed rejection kinds.
- `dusk-cli-substrate` — `dusk init` / `validate` / `inspect` (raw) / `doctor --check-hook [--repair]`.

Phase 1 built no model-in-the-loop machinery. The injectable `Clock` convention + the temp-repo factory + the real-hook invoker shipped; the scripted-verdict Verifier double was deferred to Phase 2 (design D7) — that's why building it is `tasks.md` §4. The eight `@dusk/*` packages that exist on `main` are: `test-harness`, `core-schema`, `core-parser`, `core-graph`, `core-decoration`, `core-index`, `pre-tool-use`, `cli`. Phase 2 adds: `runtime/orchestrator`, `runtime/memory`, `runtime/skills`, `runtime/tool-scope`, `runtime/verifier`, `runtime/verifier-test-double`, `delivery/mcp-server`. The CLI gains commands; existing packages are untouched (except `@dusk/cli` which the new `dusk verify`/`roles`/`skills` commands extend).

---

## 8. Mindset

You're implementing the phase that turns Dusk's constraint language into a verification system. When this phase lands, the v9 load-bearing properties — polarity inversion at the runtime boundary, deterministic `compose: implies` antecedents, the verdict split, scoped reading, the structural diagnosis no-leak — become **falsifiable** for the first time. Every test in `specs/` is a property that must hold against the real model. Every decision in `design.md` was made for a reason; if you find a reason it's wrong, surface it before you change it — don't silently deviate. Phase 3's pipeline binds to every interface you ship here.

The contract is exhaustive. The contract is the document set you just read. The contract has zero deferral except where the proposal explicitly defers.

**Build for right. Land the plane.**

---

## 9. To begin

Run:

```
/openspec-apply-change phase-2-runtime-verification
```

Work `tasks.md` top to bottom. Honor the determinism testing protocol per task. Atomic commits as you go. At §8.4, verify every cohesive-landing checkbox. Then `/openspec-archive-change phase-2-runtime-verification`. Then you're done with Phase 2; Phase 3 is the next change.
