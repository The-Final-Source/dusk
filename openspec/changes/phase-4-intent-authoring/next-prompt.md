# Handoff Prompt — Implement Dusk Phase 4 (Intent Authoring)

> Paste this whole file as the opening prompt for a **fresh Claude Code session**. It contains everything needed to implement Phase 4 of the Dusk v9 architecture accurately. The final instruction tells you exactly how to begin.

---

## 0. Your task in one paragraph

You are implementing **Phase 4 — Intent Authoring** of the Dusk v9 architecture. The work is already fully specified as an **OpenSpec change** at `openspec/changes/phase-4-intent-authoring/` (proposal + 8 capability specs + design + a dependency-ordered 47-task list). Your job is to **build the code that satisfies that change**, working `tasks.md` top to bottom, writing the behavioral tests as you go, until Phase 4's **cohesive-landing criteria** all pass — then the change is ready to archive. **Do not redesign anything**: the architecture, the capability slicing, the decisions (D1–D9), the four-scenario smoke matrix, and the acceptance tests (P4-T1..T13) are settled. Phase 4 is the **loop-closing phase** — it lifts three deliberate stubs Phase 3 shipped against frozen interfaces (the Decomposer's `implement_paused_for_authoring` escalation, Recovery Ladder L2's recovery action, and the livelock `modify_triple` verb resolution) by wiring a real 5-stage multi-turn dialog flow into each integration point. Read the source-of-truth docs, then execute. **To begin, run `/openspec-apply-change` (target the `phase-4-intent-authoring` change).**

---

## 1. Mental model — what Dusk is

Dusk is a **constraint-satisfaction system for spec-driven AI development**. The endgame: humans stop reading/writing code and instead express **intents** via agent dialog; an orchestration harness turns intents into perfectly implemented, *adherent* code. Three layers:

1. **Constraint language** — **Intents** (atomic, hierarchical via slash-namespaced path) + **total code decoration**. The intent *is* the assertion. Phase 1 shipped this layer end-to-end.
2. **Solver** — nine bounded sub-agent roles drive a 9-step request→commit pipeline. Phase 2 shipped the spawn mechanism + roles + memory + read-only MCP + the scripted-verdict Verifier double. Phase 3 shipped the full 9-step pipeline including the 4-level recovery ladder, livelock detection, pause/resume, and cooperative cancel.
3. **Verifier** — multi-agent evaluation with scoped focal+support evidence. Phase 2 shipped the Verifier procedure at `temperature: 0`; Phase 3 wired it into the short cycle, long cycle, and two-stage test-satisfaction pre-pass.

**Phase 4 is where the human-author dialog comes online.** When this phase lands, an operator (or harness) can author a complete schema-valid intent set — including test-pyramid children and a `compose: implies` conditional intent — through a real multi-turn dialog where **every branching decision surfaces as the next question**. When `dusk_implement` pauses for a missing intent, the harness drives the real `dusk_author_*` flow and resumes the paused pipeline to completion. **The `dusk_implement` ↔ `dusk_author` loop closes for the first time** — Phase 3 was a half-loop with stubs at the seams; Phase 4 makes the whole thing one continuous round trip.

---

## 2. Read these first (source of truth)

Read these in order. Do not skim — these are the contract you are implementing.

1. **`openspec/changes/phase-4-intent-authoring/proposal.md`** — what's changing and why; lists the 3 new capabilities + the 5 modified ones; pins the cohesive-landing gate as the archival criterion.
2. **`openspec/changes/phase-4-intent-authoring/design.md`** — decisions D1–D9 (read all nine before writing code); the cross-change interface seams pinned by this phase (`DialogState`, `AuthorEntryMode`, two new `DuskError` kinds, rewired `dusk_resolve_livelock` signature); risks + mitigations; resolved open questions Q1–Q4.
3. **`openspec/changes/phase-4-intent-authoring/specs/`** — 8 capability spec files (3 ADDED + 5 modified/extended); 31 Requirements; 57 Scenarios. Every Scenario maps 1:1 onto a P4-T* plan test. This is the acceptance contract — your tests must produce each named scenario's outcome.
4. **`openspec/changes/phase-4-intent-authoring/tasks.md`** — the 47-task implementation checklist in dependency order. Each task names its acceptance (capability spec scenario + P4-T* slug) and its Vitest test plan with explicit determinism surface. Work top-to-bottom.
5. **`docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md`** — the v9 architecture spec. For Phase 4 specifically read end-to-end:
   - §3.1, §3.1.1 (polarity field + matrix/constituent parser — Phase 4's Stage 4.5 imports these directly)
   - §3.2.1 (`compose: implies` with deterministic antecedents — Phase 4 emits closed-vocabulary antecedents at Stage 4)
   - §3.4.1 (livelock detector + `dusk_resolve_livelock` three verbs — Phase 4 rewires `modify_triple`)
   - §5 (Intent Authoring — the 5 stages: Intake & Framing / Discovery & Tension Detection / Industry-Practice Injection / Drafting with Pyramid Proposal / Commit)
   - §6.4.1 (Recovery Ladder — Phase 4 wires L2's recovery action)
   - §8.10 (no semantic/vector/RAG layer — Stage 2 is grep-only)
   - §8.11 (no runtime canonical-library lookup — Stage 3 is training+skill only)
   - §9.6 (the `dialog` memory scope)
   - §10.1.1 (pause/resume contract — Phase 4 fulfills the Phase-3 frozen `ImplementCheckpoint` shape)
   - Appendix A.11 (`DuskError` envelope — Phase 4 emits 5 author kinds)
   - Appendix D.10 (`ImplementCheckpoint` field set — Phase 4 enriches `suggested_dialog_seed` content without changing shape)
6. **`docs/rfcs/001-mvp-rfc/intent-architecture-roadmap.md`** — Sprint 8 is this phase. The architectural commitments table at the top is the v1 scope checklist.
7. **`docs/rfcs/001-mvp-rfc/v9-implementation-plan.md`** Phase 4 (lines 598–705) — the plan section. The P4-T* test slugs come from here. **Re-read the four-scenario phase-landing smoke (Primary "author then resume, including a conditional intent" + Variants A/B/C) and the Cohesive landing criteria checklist before you start; these are what you're driving toward.**
8. **`openspec/specs/`** — Phase 1 + Phase 2 + Phase 3's archived specs (24 capabilities), the canonical baseline. You are extending three (`bead-decomposition`, `recovery-ladder`, `livelock-detection`) and adding requirements to two (`dusk-cli-substrate`, `mcp-read-surface`); you bind to many (every Phase-1/2/3 capability). **Do not modify any Phase 1, 2, or 3 spec requirement** — bind to them.
9. **`openspec/changes/archive/2026-06-09-phase-1-substrate/design.md`** — Phase 1's pinned interface seams. Phase 4's Stage 4.5 imports `validateMatrixPredicateNegation` / `validateAntecedentGrammar` / `validateRelatesToKinds` / `validateAtomicIntent` from `@dusk/core-parser` (single source of truth for validation rules).
10. **`openspec/changes/archive/2026-06-10-phase-2-runtime-verification/design.md`** — Phase 2's pinned interface seams. Phase 4's Author runtime uses `spawnSubAgent` for Stage 2/3/4 LLM calls; the Author role file at `.claude/agents/dusk-author.md` already exists with `memory: dialog`; Phase 4 wires the dialog materializer.
11. **`openspec/changes/archive/2026-06-10-phase-3-implementation-pipeline/design.md`** — Phase 3's pinned interface seams. **Critically read design D4** (the `ImplementCheckpoint` shape Phase 4 consumes) **and D6** (the L2 artifact + recoverable error contract Phase 4's L2 recovery action consumes). The `TestVerifierLivelockReport.failing_triple` (Phase 3 §livelock-detection) is the seed for Phase 4's `modify_triple` rewire.
12. **`openspec/config.yaml`** — the version-free OpenSpec config grounding every artifact in the v9 architecture + the per-phase delivery model. **One OpenSpec change per phase, non-negotiable.**
13. **`CLAUDE.md`** at the repo root — project conventions you must follow: TypeScript strict ESM, pnpm workspaces + Turborepo, `@dusk/*` package namespace, Vitest, Drizzle ORM, functional-first, Zod as the source of truth for types, named exports only, `type` over `interface`, Result objects internally, factory functions over classes, config via injection, files < 500 lines, colocated tests.

---

## 3. The contract (don't soften it)

### What ships in Phase 4

A user can author a complete, schema-valid intent set — including test-pyramid children and a `compose: implies` conditional intent — through a real multi-turn dialog where every branching decision surfaces as the next question. Authored intents become immediately resolvable. When `dusk_implement` pauses for a missing intent, the harness drives `dusk_author_start` / `_continue` / `_finalize` and then resumes the paused pipeline to completion. Recovery Ladder L2's `bead_intent_revision_needed` error becomes actionable — the user consumes the `intent-proposal.yaml` via a scoped dialog and emits a refined intent. Livelock `modify_triple` resolution opens a scoped triple-edit dialog instead of taking an inline payload. Abandoned dialogs and checkpoints are GC'd on the 24h window.

### What "ALL of v1" means for Phase 4

Every commitment listed in `tasks.md` and `specs/` ships in this change. No carry-over to Phase 5 except what is **explicitly** named as a Phase-5 surface in the proposal's "Non-Goals". Specifically Phase 4 must deliver:

- **`packages/runtime/author`** — the Author runtime implementing the 5-stage continuation flow with **every user decision a real branching point** (RFC §5). Stage 1 framing-loopback (P4-T11), Stage 2 grep + classification (NO vector search, P4-T2), Stage 3 industry-practice injection from training + skill (NO canonical-library lookup, P4-T12), Stage 4 hierarchical drafting + test-pyramid proposal (P4-T3), Stage 4.5 validations (P4-T4/T5/T6), Stage 5 atomic finalize (P4-T7).
- **Stage 4.5 validations** importing **Phase-1 parser primitives directly** (no reimplementation — single source of truth). Violations bounce back to Stage 4 with typed skill-name hints.
- **The seven Author skills** (`polarity-decision`, `typed-relates-to`, `implies-antecedent-grammar`, `tension-detection`, `discovery-grep-patterns`, `best-practices-application`, `test-pyramid-proposal`) with **concrete authoring guidance** (≥30 substantive lines each, not stubs; per design Q2 with worked examples).
- **`DialogState`** frozen in `@dusk/core-schema` (cross-proposal interface — Phase 5 audit reads it); YAML+Markdown disk format mirroring Phase 2 bead memory; every-transition persistence; cross-restart survival; per-`dialog_id` advisory file lock for concurrent writes.
- **Three MCP tools** — `dusk_author_start` (3 entry modes), `dusk_author_continue`, `dusk_author_finalize` — with uniform `DuskError` envelope (5 author kinds: 3 Phase-2-pinned + 2 new).
- **`/dusk-author` slash command** wrapping the three MCP tools.
- **Decomposer-Author bridge** — `enrichDialogSeed(unresolvedRefs, snapshot) → string` pure transform replacing Phase 3's `unresolved_refs.join(", ")` stub. The `ImplementCheckpoint` shape stays **FROZEN per Phase-3 D4** — only `suggested_dialog_seed` content evolves.
- **L2 recovery action** — `dusk_author_start({entry_mode: "l2_recovery"})` consumes `intent-proposal.yaml` via Stage-3 injection; on finalize, the refined intent file is written; user re-invokes `dusk_implement` to retry the bead (no auto-restore).
- **Livelock `modify_triple` HARD CUTOVER** — the Phase-3 inline-`payload` form is REMOVED from the MCP signature; callers passing the old form receive `config_invalid`. The new form opens a scoped single-stage Author dialog keyed to `TestVerifierLivelockReport.failing_triple`; finalize writes back in-place; bead resumes at the failing iteration with the refreshed intent.
- **`dusk author` CLI mirror** + `dusk://dialogs/active` resource + `dusk_list_dialogs` paired tool.
- **24h GC** integration with Phase-3's existing `dusk doctor --gc-dialogs` and `--gc-implement-checkpoints`.

### Non-goals (do NOT introduce)

These are Phase 5 contracts. Building any of them now leaks scope and breaks the per-phase delivery model:

- Fresh-Verifier audit, `/dusk-doctor --static-analysis`, observability sinks, benchmark harness, seeded-violations fixture, dogfooding on real packages.
- **Any embedding/vector/RAG substrate.** Stage 2 is **grep-only** per RFC §8.10. If you find yourself wanting a vector index, stop.
- **Any runtime canonical-library lookup.** Stage 3 uses training + the `best-practices-application` skill content per RFC §8.11. No `fetch`, no canonical-pattern files read at runtime.
- Reshaping any Phase 1/2/3 capability — `ImplementCheckpoint`, `TestVerifierLivelockReport`, `intent-proposal.yaml` shape, `Verdict`, `SubAgentTrace`, etc. — every read/write path is consumed as-is.
- App-package code (`packages/{api,web,shared,hooks,mobile}`) — untouched (Phase-5 dogfood targets).

---

## 4. Build philosophy — HARD constraints (do not soften)

### 4.1 Build the RIGHT thing the RIGHT way

No deference. No shortcuts. No `// TODO: Phase 5 will wire this`. Assume infinite resources, runway, scope. The phase ships **whole** — every behavioral test passes, every cohesive-landing checkbox is true, then the change archives.

### 4.2 Khorikov classical / behavior-focused testing

Same as Phase 2 + Phase 3:
- **Test observable behavior, not implementation.** A refactor that preserves behavior must not break a test.
- **Real dependencies first.** Real file system, real Phase-2 `ModelClient` (ambient Claude Code CLI) for content-correctness tests, real `dusk_implement` pipeline for the cross-tool resume test, real git for that smoke leg.
- **Mocks only for unmanaged dependencies.** Two substitutes:
  - The **`ScriptedAuthorResponse`** test seam (Phase-4 analog of Phase 2's scripted-verdict Verifier double) replaces the LLM for control-flow tests on the Author surface.
  - Phase 2's scripted-verdict Verifier double — still in use for any Phase-3 control-flow paths Phase 4 transitively touches (e.g., the smoke L2 recovery test where the bead is driven to exhaustion).
- **Each test asserts one unit of behavior.** Not "this function returns this value" — "this user-observable outcome holds when this trigger happens."
- **Wiring/scaffolding does not need testing.** Type declarations, package scaffolding — skip.
- **Resistance to refactoring.** Tests that break on internal API renames are a liability.

### 4.3 Determinism testing posture

Phase 4's test split is the cleanest yet:

- **Control-flow / orchestration tests** run **zero-LLM via the `ScriptedAuthorResponse` test seam**. `N=1` is sufficient (deterministic). Use them for:
  - State-machine transition tests (3.1 pure transition, 3.5 pyramid pick, 3.6 4.5 bounces, 3.9 typed `relates_to` emission)
  - Dialog persistence + lifecycle (2.1, 2.3, 2.4, 2.5, 2.6)
  - MCP transport (4.1, 4.2, 4.3, 4.4, 4.5)
  - Stage-1 loopback (3.2 — P4-T11)
  - Cross-tool integration mechanics where the *user surface* is the assertion target (5.4 paired with real-model leg)
  - L2 recovery flow (6.1, 6.2, 6.3)
  - `modify_triple` rewire (7.1, 7.2, 7.3, 7.4)
  - CLI mirrors (8.1, 8.2, 8.3, 8.4, 8.5)
  - MCP read-surface (9.1)
  - Smoke Variants A, B, C, D (10.3)

- **Content-correctness tests** run against the **real frontier model** at `temperature: 0` with the pre-registered `N=3, threshold ≥2/3` protocol. Use them for:
  - **3.3** — Stage 2 grep + frontier-model classification (P4-T2)
  - **3.4** — Stage 3 greenfield branch on practice rejection (P4-T12)
  - **3.7** — Stage 4 polarity emission (P4-T4)
  - **3.8** — Stage 4 `compose: implies` antecedent emission (P4-T5)
  - **5.4** — P4-T8 cross-tool end-to-end (real frontier model + real fs + real git)
  - **10.3 Primary scenario** — the smoke matrix's happy path

- **Unit-only tests** are restricted to three pure transforms:
  - **1.2** — schema-validation tests over `DialogState` fixtures
  - **3.1** — the pure transition function in isolation
  - **5.1** — `enrichDialogSeed(unresolvedRefs, snapshot)` (the Decomposer enrichment transform)

If a task in `tasks.md` doesn't name the determinism surface, default to integration-against-real-deps. Never reach for a mock to avoid wiring complexity.

### 4.4 Phase ships whole — cohesive landing is the archival gate

When you think you're done, run §10.4 of `tasks.md` against reality. Every box must be true:

- All P4-T1..T13 green vs real dependencies.
- The four-scenario smoke matrix (Primary + Variants A/B/C/D in `tasks.md` §10.3) all green.
- `dusk_author_*` + `/dusk-author` + `dusk author` CLI mirror + `dusk doctor --gc-dialogs` + `--gc-implement-checkpoints` operable; `--help` works on each new command.
- No carry-over: the Decomposer escalation invokes the **real** Author flow (the Sprint-5 stub is removed from Phase 3's `bead-decomposition` — `enrichDialogSeed` is the only producer of `suggested_dialog_seed`); the `modify_triple` verb is the **dialog-continuation form** (the Phase-3 inline-`payload` form rejects with `config_invalid`); the L2 recovery action consumes `intent-proposal.yaml` via Stage-3 injection.
- All Stage 4.5 validations bounce real violations against the Phase-1 parser primitives; authored intents are schema-valid v2 and immediately resolvable; **no code is modified during authoring** (only `.ia/intents/<path>/intent.yaml` files are touched).
- `openspec validate phase-4-intent-authoring --strict` passes.

Then archive via `/openspec-archive-change phase-4-intent-authoring`.

---

## 5. Cross-change interface seams

### 5.1 Phase 1 + Phase 2 + Phase 3 seams — Phase 4 BINDS, never reshapes

These shapes are frozen by the archived `design.md` files. Bind to them; do not reshape them:

- **Schema types** (Phase 1) — `Intent`, `Triple` (affirmative slots + `polarity`/`quantifier`/`scope`), `ComposeRule`, five-kind `RelatesTo`, closed-vocabulary antecedent union. Phase 4's Stage 4 emits these shapes.
- **Decoration record** (Phase 1) — read by `derived-index` queries during Stage 2 grep + classification.
- **Derived-index query interface** (Phase 1; backed by session snapshot per Phase 3) — Stage 2 reads via this interface.
- **Phase-1 parser primitives** — `validateMatrixPredicateNegation`, `validateAntecedentGrammar`, `validateRelatesToKinds`, `validateAtomicIntent` from `@dusk/core-parser`. **Stage 4.5 imports these directly — this is the single source of truth for validation. Do not reimplement.**
- **`dusk.config.yml`** (Phase 1) — Phase 4 reads `models.default`/`models.overrides` for the Author runtime's LLM calls.
- **Test harness** — Phase 1 temp-repo factory + injectable `Clock`; Phase 2 trace-stream tail reader + scripted-verdict double; Phase 3 `MockGitWorktree` + `MockClock` advance helper. Phase 4 extends with `ScriptedAuthorResponse[]` driver + `MockDialogStateBuilder` + dialog-tail-reader + `MockUnresolvedIntentFixture`.
- **`SubAgentTrace`** (Phase 2) — Phase 4's Author runtime emits traces per the existing shape; no new fields.
- **`Verdict`** (Phase 2) — Phase 4's livelock-`modify_triple` rewire reads the failing triple from `TestVerifierLivelockReport.failing_triple` (the report carries the affected triple).
- **`spawnSubAgent({verifierFactory?})`** (Phase 2) — Phase 4 uses this for the Author runtime's Stage 2/3/4 LLM calls (`tools: [Read, Grep]` for Stage 2 grep; advisory).
- **Author role file** (Phase 2) — `.claude/agents/dusk-author.md` already exists with `memory: dialog`. Phase 4 wires the `dialog` materializer.
- **`ModelClient`** (Phase 2 — ambient Claude Code CLI) — Phase 4's content-correctness legs use it.
- **`DuskError` envelope** (Phase 2) — Phase 4 emits 5 author kinds (3 Phase-2-pinned + 2 new).
- **`ImplementCheckpoint`** (Phase 3 D4) — **shape FROZEN**. Phase 4 enriches `suggested_dialog_seed` *content* via the `enrichDialogSeed` pure transform; the JSON shape is unchanged.
- **`TestVerifierLivelockReport.failing_triple`** (Phase 3 §livelock-detection) — Phase 4's `modify_triple` rewire seeds the scoped dialog from this field.
- **`intent-proposal.yaml`** (Phase 3 §recovery-ladder L2 artifact) — Phase 4's L2 recovery action consumes this file shape; lives in `@dusk/core-schema` per Phase 3.

### 5.2 Phase 4 PINS new seams in `@dusk/core-schema` — Phase 5 consumes

Per design D9:

- **`DialogState`** — the disk-persisted dialog shape Phase 5 audit reads to inspect human-Author negotiation transcripts.
- **`AuthorEntryMode`** — `"full" | "scoped_triple_edit" | "l2_recovery"`. Phase 5 audit may discover dialogs in any of these modes.
- **Two new `DuskError` kinds** — `author_finalize_partial_failure` (Stage 5 rollback case) + `author_l2_proposal_unreadable` (L2 entry with a malformed proposal file).
- **Rewired `dusk_resolve_livelock` signature** — `payload` parameter REMOVED; `dialog_init?` parameter ADDED. Phase 5 audit binds to the new shape.

Place every new schema in `@dusk/core-schema` (NOT in `runtime/*` packages). This keeps the dep graph acyclic — Phase 5's audit will need to import the `DialogState` shape, and a runtime→core dep would not cycle but the convention from Phases 2+3 is to place all cross-proposal interfaces in `@dusk/core-schema`. Hold the convention.

---

## 6. Implementation approach — how to actually do this

### 6.1 Use `/openspec-apply-change`

Don't try to free-implement from memory. The flow is:

```
/openspec-apply-change phase-4-intent-authoring
```

This walks `tasks.md` top-to-bottom. For each task, you implement the code, write the named test, run it against real dependencies (or `ScriptedAuthorResponse` per the determinism posture), and check the box. Atomic conventional commits per task (or per small task group) — Phase 3 produced ~22 commits across 63 tasks; Phase 4's 47 tasks should produce 15–30 commits.

### 6.2 Respect dependency order (and the safe parallelism)

`tasks.md` is ordered by dependency. Don't skip ahead. The safe forks:

- §2 (`dialog-state`) is foundational. Everything binds to it.
- §3 (`author-five-stage-flow`) is the heart. Largest group (12 tasks). Stage 4.5 (3.6) imports Phase-1 primitives — that's the load-bearing wire.
- §4 (`author-mcp-surface`) wraps §3. Can start after §3.5 (transition function + a few stages) — §4.1/4.2/4.3 just thin-wrap.
- §5, §6, §7 (the three Phase-3 modifications) can be worked **in parallel** after §4 lands — each closes its own stub at a different integration point.
- §8 (CLI extension) follows §4.
- §9 (MCP read-surface extension) is independent — can be worked at any point after §2.
- §10 (smoke + cohesive landing) is last.

### 6.3 Atomic commits, conventional commits

Match Phase 1/2/3's commit cadence: small, focused, conventional-commits formatted. Use `chore:`/`feat:`/`refactor:`/`test:`/`docs:` prefixes; reference the task slug (e.g., `P4-T8`) and the package in the subject line where useful. Run the `/atomic-commits` skill at natural breakpoints.

### 6.4 Validate as you go

After every few tasks: `openspec validate phase-4-intent-authoring --strict`. After the package scaffolding lands: `pnpm typecheck` + `pnpm build` + `pnpm test` from repo root. Treat any failure as a stop-the-line — don't accumulate broken state.

### 6.5 The hardest tasks (re-read the docs for these)

- **3.6** — Stage 4.5 importing Phase-1 parser primitives. This is the "single source of truth" wire. Read the Phase-1 archived `design.md` to understand what each primitive returns; map the violation codes to the three skill-name hints (`polarity-decision`, `implies-antecedent-grammar`, `typed-relates-to`).
- **3.3 / 3.4** — Real-frontier-model legs for Stage 2 grep + classification and Stage 3 greenfield. These need fixture intents and careful prompt design; the `N=3, threshold ≥2/3` protocol means flaky-prompt-prone tests fail intermittently. Iterate on prompt design until the threshold holds.
- **3.7 / 3.8** — Polarity emission + closed-vocabulary antecedent emission (real frontier model). Same intermittency risk — the prompts must reliably steer the model toward the structural outcome.
- **3.10** — Atomic Stage 5 finalize with rollback. The atomicity contract requires the same temp+rename semantics Phase 1 uses; on partial failure, ALL temp files must be cleaned + dialog preserved.
- **3.11** — Authoring the seven skill files with concrete guidance. ≥30 substantive lines per file with worked examples. This is content work, not code work — but it's load-bearing for Stage 3 and Stage 4 quality.
- **5.1** — `enrichDialogSeed` pure transform. Read the snapshot for surrounding context (parent, siblings via path traversal, related intents); produce business-vocabulary framing. Unit-testable in isolation.
- **5.4** — P4-T8 cross-tool integration. The end-to-end test that pause → real author flow → resume actually closes. Real frontier model + real fs + real git. This is the most expensive smoke leg.
- **7.1 / 7.2 / 7.3 / 7.4** — Livelock `modify_triple` rewire. The `payload` parameter removal is a hard cutover; existing Phase-3 callers are rejected with `config_invalid`. Replace with `dialog_init` carrying the failing-triple seed.
- **10.3** — The four-scenario smoke matrix (Primary + Variants A/B/C/D). The Primary requires the real frontier model running `N=3 ≥2/3` end-to-end through pause → author → resume. This is what proves the phase ships whole.

For each: re-read the cited RFC §, re-read the cited spec scenario(s), look at Phase 2's archive for analogous patterns (`spawnSubAgent` flow, scripted-verdict double pattern). The contract is exhaustive — the answer is in the docs.

---

## 7. Phase 1 + Phase 2 + Phase 3 status (so you know where you're stepping in)

### Phase 1 (archived `openspec/changes/archive/2026-06-09-phase-1-substrate/`)
21 requirements across 7 capabilities synced into `openspec/specs/`. Packages: `@dusk/test-harness`, `@dusk/core-schema`, `@dusk/core-parser`, `@dusk/core-graph`, `@dusk/core-decoration`, `@dusk/core-index`, `@dusk/pre-tool-use`, `@dusk/cli`. Phase 4 imports parser primitives from `@dusk/core-parser`.

### Phase 2 (archived `openspec/changes/archive/2026-06-10-phase-2-runtime-verification/`)
36 requirements across 5 ADDED + 1 ADDED-delta capabilities. Packages: `@dusk/runtime-orchestrator`, `@dusk/runtime-memory`, `@dusk/runtime-skills`, `@dusk/runtime-tool-scope`, `@dusk/runtime-verifier`, `@dusk/runtime-verifier-test-double`, `@dusk/delivery-mcp-server`. 9 role files including `.claude/agents/dusk-author.md` (`memory: dialog`). Phase 4 wires the `dialog` materializer via `@dusk/runtime-memory`'s existing four-scope contract.

### Phase 3 (archived `openspec/changes/archive/2026-06-10-phase-3-implementation-pipeline/`)
55 requirements across 12 ADDED + 2 MODIFIED capabilities. 12 new `@dusk/runtime-*` packages including `@dusk/runtime-decomposer`, `@dusk/runtime-recovery-ladder`, `@dusk/runtime-livelock-detection`. The three Phase-3 stubs Phase 4 lifts:
- **Decomposer escalation stub** — Phase 3 ships the `ImplementCheckpoint` shape + the `implement_paused_for_authoring` error envelope but the `suggested_dialog_seed` is `unresolved_refs.join(", ")` (naive). Phase 4 replaces with `enrichDialogSeed`.
- **Recovery Ladder L2 stub** — Phase 3 ships the `intent-proposal.yaml` artifact + `bead_intent_revision_needed` recoverable error, but the recovery *action* (consuming the proposal) doesn't exist. Phase 4 adds `entry_mode: "l2_recovery"`.
- **Livelock `modify_triple` stub** — Phase 3 accepts an inline `payload: {edited_triple}` directly. Phase 4 hard-cuts to `dialog_init` carrying the `failing_triple` seed; opens a scoped Author dialog.

### What Phase 4 adds

One new `@dusk/runtime-author` package + extensions to `@dusk/delivery-mcp-server` (3 author MCP tools + `dusk://dialogs/active` resource + `dusk_list_dialogs` paired tool) + `@dusk/cli` extension (`dusk author` command with `--continue`/`--finalize`) + 7 skill files at `.claude/skills/dusk/author/` filled in with concrete guidance.

### Critical Phase 2 reminder

The Author runtime calls the LLM via Phase 2's `ModelClient` — the **ambient Claude Code CLI** (`claude -p`, ambient auth). **No `ANTHROPIC_API_KEY` required.** Phase 4's content-correctness legs (3.3, 3.4, 3.7, 3.8, 5.4, 10.3 Primary) use this path. Run via `pnpm test:correctness` (or whatever the project's correctness-gated env-var is per the Phase 2/3 conventions); control-flow suite via `pnpm test`.

---

## 8. Mindset

You're implementing the phase that closes the loop. When this phase lands, `dusk_implement` can pause for missing intents, a user can drive a real multi-turn dialog to author them, and the pipeline resumes to completion — for the first time, the round trip works. The three deliberate stubs Phase 3 shipped against frozen interfaces (`ImplementCheckpoint`, `intent-proposal.yaml`, `TestVerifierLivelockReport.failing_triple`) become real consumers. Every Stage 4.5 validation rule lives in Phase 1's parser primitives — you import, you don't reimplement; rule drift between Author and gate is structurally impossible by construction. Stage 2 is grep-only (no vector substrate) and Stage 3 is training+skill (no canonical-library lookup) — these are explicit RFC commitments, not optimization deferrals. If you find yourself wanting to add a vector index or a runtime canonical-pattern lookup, stop and re-read RFC §8.10 / §8.11.

The contract is exhaustive. The contract is the document set you just read. The contract has zero deferral except where the proposal explicitly defers.

**Build for right. Land the plane.**

---

## 9. To begin

Run:

```
/openspec-apply-change phase-4-intent-authoring
```

Work `tasks.md` top to bottom. Honor the determinism testing protocol per task. Atomic commits as you go. At §10.4, verify every cohesive-landing checkbox. Then `/openspec-archive-change phase-4-intent-authoring`. Then you're done with Phase 4; Phase 5 (Validation, Benchmarking & Dogfooding — fresh-Verifier audit, static-analysis doctor, observability sinks, benchmark harness, seeded-violations fixture, dogfooding on real packages) is the next change. Phase 5 reads everything you produce here.
