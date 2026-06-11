# Intent Architecture — v9 Implementation Plan (Phase-Focused, Behavior-Gated)

| | |
|---|---|
| **Implements** | [Intent Architecture Proposal v9](./intent-architecture-proposal.md) |
| **Complements** | [Build Roadmap v5](./intent-architecture-roadmap.md) |
| **Date** | 2026-06-09 |
| **Status** | Draft |
| **Adds over the roadmap** | Behavioral-test integration at each phase boundary + cohesive-landing criteria that gate the next phase. |

This document is the **contract the v1 build is measured against**. The roadmap decomposes v9 into 10 sprints; this plan groups those sprints into 5 phases and, for each phase, specifies the behavioral tests that prove the phase delivered what it promised, plus the cohesive-landing gate the next phase cannot start without. Every commitment in the roadmap's "Architectural commitments locked for v1" table and every item in the RFC's v1 scope is covered here — the coverage matrix at the end is the checklist. Nothing is punted to v1.x except items the roadmap's "What's deferred to v1.x" section explicitly defers.

A sixth phase — **Phase 6, the Greenfield POC** — is specified after Phase 5. It is **post-v1**: the first v1.x change, not part of the v1 gate, and it adds no rows to the coverage matrix. It is in this document because it follows the same phase discipline (one OpenSpec change, behavioral tests, a cohesive-landing gate) and because its shape was settled while the v1 plan was live: v1's dogfood validates decorate-at-authorship on existing code; Phase 6 validates the thesis in its pure form — an API application where every line was born through Dusk.

---

## Delivery model — one OpenSpec change proposal per phase

**Each of the five phases below is delivered as its own OpenSpec change proposal** under `openspec/`. This plan is the umbrella; OpenSpec is the per-phase execution vehicle. The mapping is fixed:

- **One phase → one OpenSpec proposal.** The proposal's scope is exactly this phase's **Scope** section. Nothing from a later phase leaks into an earlier proposal, and no proposal is "partial" — a phase ships whole or not at all (the cohesive-landing rule).
- **This phase's behavioral tests + phase-landing smoke test become the proposal's acceptance criteria.** The OpenSpec spec deltas describe the *capabilities*; the behavioral tests here are the falsifiable verification that the deltas were met. A proposal's task list is not "done" until its phase's tests are green against real dependencies.
- **This phase's Cohesive landing criteria become the proposal's archival gate.** An OpenSpec proposal for phase N is not archived until every box in phase N's landing checklist is checked. The next phase's proposal does not open against `main` until the prior phase's proposal is archived — except where the **Phase sequencing & parallelism** note below explicitly authorizes overlapping authorship (Phase 2's two halves; Phase 4 alongside the back half of Phase 3).
- **The coverage matrix is the cross-proposal ledger.** It guarantees that, summed across the five OpenSpec proposals, every v1 commitment is delivered exactly once and nothing is silently dropped between proposals.

Read each phase below as the **brief for one OpenSpec proposal**: its Outcome is the proposal's "why," its Scope is the "what changes," its Behavioral tests + smoke test are the "how we know it's right," and its Cohesive landing criteria are the "definition of done."

**Phase 6 follows the same delivery model post-v1**: it is scaffolded as its own OpenSpec change (`phase-6-greenfield-poc`) only after the Phase-5 change archives and v1 is landed. (When that change is created, `openspec/config.yaml`'s phase-order note gains the one-line Post-v1 entry — deliberately not edited while the Phase-5 change is in flight.)

---

## Conventions (read once)

**Test tool.** Vitest, colocated `*.test.ts`, per `CLAUDE.md`. Mentioned here once; not repeated per test.

**Managed vs unmanaged dependencies (Khorikov).** Postgres, the file system, git, the Vitest runner, the in-memory derived index, the PreToolUse hook process, and the Verifier/Engineer model calls (when the test is *about* LLM-mediated behavior) are **managed** — tested against the real thing with real fixtures. The only **unmanaged** dependencies that get mocked are third-party push/webhook endpoints and external analytics sinks (PostHog/OTLP). The LLM is treated as a managed dependency *for behavior-of-the-pipeline tests*: assertions are on **structural, deterministic outcomes** of LLM-mediated runs (verdict `decision`, presence/absence of a `file:line` citation, presence/absence of a negation substring in the **captured raw prompt**, trace-field population) — never on exact rationale prose — so the tests survive model nondeterminism. Fixtures for these are curated to be unambiguous (known-good / known-bad) so the outcome is stable.

**The split that makes the LLM-heavy tests buildable: orchestration logic uses a Verifier double; behavior uses the real model.** Two categories of test that earlier drafts conflated are now kept apart. (a) **Control-flow / orchestration tests** — anything that exercises *the pipeline's reaction to verdicts* rather than *the verdict's correctness*: iteration budgets, the stuckness detector, the N=2 confirmation pass and its flake-dismissal, livelock detection, the recovery ladder, cancel/drain. These are driven by a **scripted-verdict Verifier double** (a test seam that returns a pre-scripted verdict sequence) so they assert pure control-flow predicates with **zero model calls** — deterministic, fast, free. This does NOT violate "LLM as a managed dependency": the thing under test is the orchestration, not the model. (b) **Verdict-correctness tests** — does the real Verifier reject offset-pagination, fail a misdescribed support triple, etc. — run against the **real frontier model** (see posture below) on curated fixtures, asserting only structural outcomes.

**Model & determinism posture (v1 — not built to scale).** v1 leans on a single **frontier-tier model** across roles for higher determinism and judgment quality; tier-down and per-role cost optimization are deferred to the Sprint-9 efficacy benchmark, not pursued up front. All Verifier/Test-Runner **verdict calls run at `temperature: 0`** in normal and test operation, which — combined with frontier-model quality and unambiguous fixtures — makes single-shot structural assertions stable enough for v1 without elaborate retry machinery. Where the architecture *needs* sampling variance to be meaningful (the §7.5 fresh-Verifier audit; the N=2 confirmation pass), tests use **statistical thresholds with an explicit N**, not single-shot hard asserts, and the *mechanism* of those features is tested separately with the Verifier double. CI is **pragmatic, not scale-ready**: deterministic tests (the bulk) run on every change; the smaller real-model behavior cohort runs against the configured frontier model on demand and in the benchmark/dogfood phase. We optimize the test substrate (and model tiers) once we are measuring the system's efficacy — not before.

**Transport-failure amendment to the N=3 ≥2/3 real-model protocol (pre-registered; arch-board 2026-06-11 D4 — standing rule for every real-model correctness leg, Phase 4 onward, including the Sprint-9/Phase-5 benchmark).** (1) Each model call gets ONE retry on a thrown transport error (timeout, spawn failure, non-zero CLI exit, envelope failure) — a throw is a **null observation** carrying no content by construction, so a retry can never re-roll content evidence. (2) A run that still throws **consumes one of the N attempts as a non-success** — transport outcomes are never counted as successes, which biases strictly against passing (two transport deaths fail an N=3 leg outright). (3) Content failures are NEVER retried. (4) Deterministic invariant assertions inside a real-model test (e.g. no-vector-substrate, no-canonical-lookup, author-only spawns) are **hard-fail and sit OUTSIDE the 2/3 content threshold** — an assertion failure fails the suite immediately and is never swallowed as a consumed attempt. (5) An implementation MAY stop early once the threshold is mathematically decided. This amendment was adopted after Phase-4 execution observed transient ambient-CLI exit-1 failures; it changes how infrastructure noise is bookkept, not what counts as content evidence.

**Behavioral, not implementation.** Every test below asserts a user- or operator-observable outcome (a verdict, a commit, a trailer, a trace field, an exit code, a returned `DuskError`, a file on disk, a satisfaction rollup). None asserts an internal call sequence, a function signature, or a private field name. The trace stream, commit trailers, MCP tool outputs, doctor exit codes, and on-disk runtime artifacts are **product surfaces** — asserting on them is asserting on observable behavior, and they survive any non-behavioral refactor.

**Unit-only tests are marked and rare.** A handful of pure deterministic transforms with dense algebra (the negation detector, the citation-precision scorer, the slot-focus keyword classifier, the `support_quality` aggregator, the stuckness predicate) are tested unit-only because integration coverage of them is redundant and they have no I/O. Each is flagged `(unit-only)` with the justification inline. Everything else is integration-style.

**Wiring is not tested.** Zod type declarations, barrel exports, the `dusk.config.yml` loader shape, role-frontmatter parsing, factory wiring, and MCP transport plumbing are exercised *through* the behavior that uses them, not directly.

**Cohesive landing.** A phase lands only when (a) all its behavioral tests pass against real dependencies, (b) its phase-landing smoke test is green, (c) its user-facing surface is operable with working `--help`, and (d) nothing is left "to be wired next phase." The next phase does not start until the prior phase's landing checklist is fully checked.

**`dusk.config.yml` is assumed present** with the v9 defaults from the roadmap (`test_pyramid.suffixes`, `sanity.*`, `models.*`, `test_runner.*`). Tests that vary behavior by config set it explicitly in a fixture config.

**Shared test infrastructure (built once, in Phase 1, reused by every phase).** The behavioral tests below lean on a small set of real-dependency harnesses, not mocks: (1) a **temp-repo factory** that materializes a throwaway `git init` repo with `.ia/`, `dusk.config.yml`, and a chosen intent/decoration fixture set; (2) a **real-hook invoker** that pipes a `HookInput` to the installed gate binary over stdin and reads the `HookOutput` — exercising the actual process, not an in-proc shim; (3) the repo's existing **Docker Postgres** for any test whose intents touch the DB layer (e.g., `db/use-drizzle-orm`, the `notifications/send` integration tests); (4) **real Vitest invocation** for the Test Runner; (5) **curated LLM fixtures** (known-good / known-bad / controversial diffs) run against the real frontier model at `temperature: 0`, asserting only deterministic structural outcomes; (6) a **scripted-verdict Verifier double** — a test seam (`DUSK_TEST_VERDICTS`-style injection) that makes the Bead Orchestrator consume a pre-scripted verdict sequence instead of spawning a real Verifier, used by every control-flow test (budgets, stuckness, confirmation pass, livelock, recovery ladder); (7) an **injectable clock** (all TTL/GC/drain logic reads an injected `now()`, never `Date.now()` directly) so 24h-window and drain-accounting tests are deterministic rather than sleep-based. Items (6) and (7), plus the temp-repo factory and hook invoker, land green in Phase 1 so later phases build on a trusted base. (Raw-prompt capture — the observable surface several Phase-2/3 tests assert against — is a property of the spawn pipeline and lands in Phase 2.)

**Phase sequencing & parallelism (from the roadmap dependency map).** Phases run 1 → 2 → 3, then 4 and 5. Within Phase 2, the role-files/memory/spawn half (Sprint 3) and the MCP/Verifier read-path half (Sprint 4) may be authored in parallel — they intersect only at the Verifier spawn point, which Sprint 4 stubs until Sprint 3 lands. Phase 4 (authoring) may be authored in parallel with the back half of Phase 3 — its only coupling is the Decomposer escalation hook, stubbed in Phase 3 and replaced for real in Phase 4 (test P4-T8). A phase's **cohesive-landing gate is still sequential** regardless of authoring parallelism: Phase 3's gate cannot close until its smoke variants pass, and Phase 4's pause/resume smoke test depends on Phase 3's pause mechanism being green.

---

## Phase 1 — Substrate

Roadmap Sprints 1–2. The read/write substrate the entire runtime stands on: intent schema + parser + graph + derived index, the decoration parser, and the PreToolUse gate that enforces decoration at write time. Nothing in this phase spawns a sub-agent or calls a model — it is pure deterministic machinery, and it must be airtight because everything above it trusts it.

### Outcome

An operator can author v9 intent files and decorate TypeScript with all six markers, and the system reads both into a coherent in-memory index, answers hierarchical-satisfaction and focal/support queries against it, and **mechanically blocks any write that breaks decoration completeness** through an installed PreToolUse hook. `dusk init` installs that hook idempotently without ever clobbering an existing one, and `dusk doctor --check-hook` proves the gate is live. v8 intent corpora load and migrate to v9 without authoring intervention.

### Scope

- **`packages/core/schema`** — Zod schemas for `schema_version: 2` Intent, Triple (with `polarity`, `quantifier`, `scope`), ComposeRule (`all|any|none|implies`), five-kind typed `RelatesTo`, and the **antecedent-triple discriminated union** (closed predicate vocabulary + resolvable-reference object). TS types via `z.infer`. Path-to-id rule and reserved-suffix rule (configurable via `test_pyramid.suffixes`). (Sprint 1; RFC §2.1, §3.1, §3.2, App. A.1.)
- **v8→v9 migration loader** — flat `relates_to: [string]` → `{kind: sibling}`; `kind: refines` → `kind: parent`; `negated: true` → `polarity: negative`; deprecation warnings on each. (Sprint 1; RFC App. C, App. D.19.)
- **`packages/core/parser`** — `intent.yaml` read → validated Intent; write → canonical deterministic form (atomic temp+rename); clear `file:line` validation errors. Includes **`negation-detector.ts`** (POS-aware matrix/constituent scanner, ~200 LOC, no ML) and **antecedent-grammar validation** for `compose: implies`. (Sprint 1; RFC §3.1.1, §3.2.1.)
- **`packages/core/graph`** — recursive load of `.ia/intents/`, path-id resolution, upward/downward traversal, typed `relates_to` resolution (all five kinds), cycle detection, and test-pyramid-children resolution. (Sprint 1; RFC §2.1, §2.3.)
- **`packages/core/decoration`** — parser for all six markers (`@intent`, `@intent-support`, `@intent-test`, `@intent-test-file`, `@intent-file`, `@intent-ignore`) over TypeScript, plus `.intent` directory-scope files. Emits structured decoration records. (Sprint 2; RFC §2.4–2.8, App. A.2–A.3.)
- **`packages/core/index`** — the derived index: forward (`intent → claimants`), reverse (`file → intents`), **focal/support (`(intent, aspect) → (focal[], support[])`)**, aspect-rollup (`intent → unsatisfied aspects`), test-discovery (`intent → test decorators by layer`), and hierarchical satisfaction (parent satisfied iff own triples pass AND every child incl. test-pyramid children satisfied). In-memory, rebuilt at session start. (Sprints 1–2; RFC §2.9.)
- **`packages/delivery/pre-tool-use`** — PreToolUse hook handler implementing the §4.6.1 wire format (stdin `{tool,args,session_id,transcript_path}` → stdout `{decision}`; exit 0 both ways; process failure → fail-safe block `hook_internal_error`), running **all 10 mechanical checks** including check 10 (matrix-predicate negation in `@intent-support` predicate slot, reusing the negation detector). Structured rejection payloads per App. A.8. (Sprint 2; RFC §4.6, §4.6.1, App. A.8, A.10.)
- **`packages/intents/canonical/` first wave** — 6 canonical intents at v9 paths (`api/pagination/cursor-only/cursor-decode`, `…/cursor-encode`, `api/pagination/page-size-bound`, `api/auth-required`, `api/idempotency`, `error-handling/explicit-not-silent`). Documentation examples + parser/graph fixtures. (Sprint 1.)
- **`packages/cli`** — `dusk init` (scaffold `.ia/*`, `dusk.config.yml`, 9 role-file stubs, hook install with **`_dusk_marker` idempotent merge + three-option conflict prompt**); `dusk validate`; `dusk inspect` (intent + file decoration views); `dusk doctor` (run all 10 checks project-wide); **`dusk doctor --check-hook [--repair]`** (exit 0/2/3). (Sprints 1–2; RFC §4.6.1, §10.2.)
- **Shared test infrastructure** — the **temp-repo factory**, the **real-hook invoker**, the **scripted-verdict Verifier double**, and the **injectable clock** (see Conventions) ship here and are themselves green before Phase 2 opens, since every later phase's control-flow tests depend on them. (Sprint 1; supports all phases.)

### Behavioral tests integrated in this phase

#### Schema, migration, and round-trip

- **P1-T1 · v8 corpus migrates without authoring intervention.**
  - **WHAT** — A project's existing `schema_version: 1` intents remain usable after upgrade.
  - **HOW** — Load a real v8 `intent.yaml` carrying `negated: true`, a flat `relates_to: ["api/pagination"]`, and an early-v9 `kind: refines` edge → assert the resolved Intent exposes `polarity: negative`, `{kind: sibling, target: api/pagination}`, and `{kind: parent}` respectively, and that a deprecation warning was surfaced for each.
  - **WHY** — RFC App. C / App. D.19; commitment row "Typed `relates_to` edges". Migration is the falsifiable promise that v8 corpora "migrate cleanly without authoring intervention" (roadmap construction note 12).

- **P1-T2 · Authored intent round-trips losslessly through parse→write→parse.**
  - **WHAT** — Writing an intent back to disk preserves its meaning and canonical ordering.
  - **HOW** — Parse a canonical intent with quantifiers, polarity, and typed edges, write it, re-parse → assert structural equality and stable triple ordering by id.
  - **WHY** — RFC §2.1, App. A.1. Protects the Author's Stage-5 commit and the doctor's re-validation against silent corruption.

- **P1-T3 · Negation detector enforces the matrix/constituent rule. (unit-only)**
  - **WHAT** — Authors are blocked from smuggling negation into a predicate slot, but legitimate constituent negation inside noun phrases is allowed.
  - **HOW** — Run the ~40-case corpus: every matrix-predicate-negation phrase (`"the type lacks a discriminator"`, `"does not return null"`, the full §3.1.1 lexicon) in a `predicate` slot rejects; every constituent-negation NP (`"a function with no required arguments"`, `"a sandboxed environment free of network access"`) in a subject/object slot passes.
  - **WHY** — RFC §3.1.1, App. D.20; commitment row "Matrix/constituent parser rule". *Unit-only justification:* a pure POS transform with dense lexical algebra and no I/O; integration coverage (P1-T11 check 10, P2 polarity) exercises its wiring, so the corpus is the right home for the algebra.

- **P1-T4 · Antecedent grammar is closed and enforced at load.**
  - **WHAT** — A `compose: implies` intent can only declare antecedents from the closed predicate vocabulary against resolvable references.
  - **HOW** — Load an `implies` intent whose antecedent uses `"performs a database write"` (behavioral) or `"returns Promise<T>"` (type-system) → assert load fails with `decoration_parse_error` pointing at the `dusk/author/implies-antecedent-grammar` skill; load one using `"is decorated with api/write-endpoint"` → assert it validates.
  - **WHY** — RFC §3.2.1, App. A.1, App. D.18; commitment row "`compose: implies` with deterministic antecedents". This is the parse-time half of the "antecedents are facts, not judgments" guarantee.

#### Graph and index

- **P1-T5 · Hierarchical satisfaction rolls up through test-pyramid children.**
  - **WHAT** — A parent intent is reported satisfied only when its own triples pass AND every child — including `…/unit-tests` / `…/integration-tests` — is satisfied.
  - **HOW** — Build an index where `notifications/send` triples pass but `notifications/send/unit-tests` has an unsatisfied aspect → assert the satisfaction query returns `notifications/send` unsatisfied with the unit-tests child named as the cause; satisfy the child → assert the parent flips to satisfied.
  - **WHY** — RFC §1.3, §3.4 ("tests are part of the intent satisfaction surface"), §2.2.

- **P1-T6 · Focal/support query returns scoped claimants per aspect.**
  - **WHAT** — The load-bearing query that lets the Verifier read ~4 lines instead of a 90-line body returns exactly the focal and support claimants for one `(intent, aspect)`.
  - **HOW** — Index the App. B `sendNotification` file; query `(notifications/send, publish-sync-per-insert)` → assert focal = the `pubsub.publish(...)` line and support = exactly the loop/timestamp/event-payload lines, with each support claim carrying its inline NL triple; assert the opt-out and error-handling lines are absent.
  - **WHY** — RFC §3.3, §4.2, App. B.4; commitment row "Decoration is total".

- **P1-T7 · `relates_to` cycle detection refuses a cyclic graph.**
  - **WHAT** — A typed-edge cycle is reported rather than silently traversed into a loop.
  - **HOW** — Author A `parent` B, B `sibling` A producing a cycle on any kind → assert the graph load surfaces a cycle error naming both intents.
  - **WHY** — RFC §2.1; roadmap Sprint 1 ("cycle detection on `relates_to` edges (any kind)").

#### Decoration parser

- **P1-T8 · All six markers parse to structured records.**
  - **WHAT** — Every decorator form the Engineer emits is recognized, including the inline support triple and the `because/reason` ignore clause.
  - **HOW** — Parse a file exercising `@intent`, `@intent-support` (with 3-slot triple), `@intent-test`, `@intent-test-file`, `@intent-file`, and `@intent-ignore because=(…) reason="…"` → assert one record per occurrence with correct `marker`, `intent_path`, `aspect_ids`, `support_triple`/`ignore_clause`, and `file:line`.
  - **WHY** — RFC §2.4–2.8, §2.9, App. A.2–A.3.

#### PreToolUse gate (10 checks → 12 typed rejection kinds, real hook process)

- **P1-T9 · Clean decorated write is approved.**
  - **WHAT** — A fully, correctly decorated edit passes the gate.
  - **HOW** — Pipe a real App.B-style decorated file as a `Write` payload through the installed hook binary over stdin → assert stdout `{decision:"approve"}` and exit 0.
  - **WHY** — RFC §4.6, §4.6.1, App. A.10. Establishes the no-false-positive baseline.

- **P1-T10 · Every App. A.8 rejection kind fires with its typed payload.**
  - **WHAT** — The gate's full *rejection surface* is enforced — not just one fixture per numbered check, but one per typed rejection kind, because the 10 mechanical checks emit **12 distinct rejection kinds** (check 2 → `unresolved_intent_path` + `unresolved_aspect_id`; check 5 → `missing_ignore_because` + `missing_ignore_reason`; plus `missing_decorator` vs `missing_statement_decorator` and `missing_support_triple` vs `malformed_support_triple` are distinct kinds). The Engineer's feedback channel pattern-matches on the kind, so every kind must be proven to fire.
  - **HOW** — Feed one fixture per App. A.8 `Rejection` kind (`missing_decorator`, `missing_statement_decorator`, `unresolved_intent_path`, `unresolved_aspect_id`, `multiple_intents_on_one_line`, `missing_ignore_because`, `missing_ignore_reason`, `invalid_ignore_predicate`, `missing_support_triple`, `malformed_support_triple`, `focal_and_support_for_same_intent`, `non_test_path_on_intent_test`) → assert each returns `{decision:"block"}` with the exact `structured_rejection.kind` and a `file:line`. (Check-10 matrix-negation is P1-T11; `invalid_ignore_predicate` overlaps P1-T18 — cross-reference, don't duplicate.)
  - **WHY** — RFC §4.6, App. A.8; commitment row "PreToolUse gate: 10 hard mechanical checks". Closes the 10-checks-vs-12-kinds coverage gap (RFC §4.6 / App. A.8 now state the mapping explicitly).

- **P1-T11 · Check 10 blocks matrix-predicate negation in a support triple.**
  - **WHAT** — An author cannot encode negation in an `@intent-support` predicate slot; they must use `polarity: negative` on the intent instead.
  - **HOW** — Feed a write whose support triple predicate is `"does not deliver"` → assert `{decision:"block"}` with kind tied to negation and a hint toward `dusk/author/polarity-decision`; feed the affirmative form → assert approve.
  - **WHY** — RFC §3.1.1, §4.6 check 10; commitment row "PreToolUse gate: 10 hard mechanical checks" (check 10 explicitly).

- **P1-T12 · Hook fails safe on internal error.**
  - **WHAT** — A malfunctioning gate blocks rather than silently approving.
  - **HOW** — Feed structurally-invalid stdin (truncated JSON) → assert the handler exits 0 with `{decision:"block", structured_rejection.kind:"hook_internal_error"}`, never `approve`.
  - **WHY** — RFC §4.6.1 ("process-level failures treated as block… to fail safe").

#### `dusk init` and `dusk doctor --check-hook`

- **P1-T13 · `dusk init` installs the gate; re-run is idempotent by marker.**
  - **WHAT** — Initializing twice leaves exactly one Dusk hook entry, matched by `_dusk_marker`, not by array position.
  - **HOW** — Run `dusk init` in a temp repo, then again → assert `.claude/settings.json` contains exactly one entry with `_dusk_marker: "dusk-pre-tool-use-gate"` and `_dusk_managed`, regardless of surrounding entries reordered between runs.
  - **WHY** — RFC §4.6.1; commitment row "`dusk init` `_dusk_marker` idempotent merge".

- **P1-T14 · Existing non-Dusk hook triggers the three-option prompt; never silent-clobbers.**
  - **WHAT** — A project with its own Write/Edit PreToolUse handler is never overwritten without consent.
  - **HOW** — Seed settings.json with a foreign Write/Edit hook, run `dusk init` answering [1] append → assert both entries present, foreign first; answering [2] replace → assert `.claude/settings.json.bak` written and `_dusk_replaced` recorded; answering [3] abort → assert non-zero exit and settings.json unchanged.
  - **WHY** — RFC §4.6.1; commitment row "`dusk init` `_dusk_marker` idempotent merge … conflict-prompt three options".

- **P1-T15 · `dusk doctor --check-hook` returns the contract exit codes; `--repair` is scoped.**
  - **WHAT** — An operator can verify and repair gate installation without masking real bugs.
  - **HOW** — On a correct install assert exit 0; delete the marker entry assert exit 2; install a deliberately-broken handler that fails the synthetic round-trip assert exit 3; run `--repair` against the exit-2 case → assert it re-runs the merge and now returns 0; run `--repair` against the exit-3 case → assert it does **not** auto-fix.
  - **WHY** — RFC §4.6.1; commitment row "`dusk init` … `dusk doctor --check-hook --repair`".

#### Directory scope, ignore vocabulary, configurable suffixes, CLI validation

- **P1-T16 · `.intent` directory-scope files parse to directory-level claims.**
  - **WHAT** — Genuinely directory-level invariants are expressible without per-function decoration.
  - **HOW** — Place a `.intent` file declaring `@intent web/no-api-runtime-imports` at a package root → assert the index records a directory-scoped focal claim for that directory and `dusk inspect` shows it; assert the file format rejects a second claim sharing a line (one claim per line).
  - **WHY** — RFC §2.7, App. A.3.

- **P1-T17 · Test-pyramid suffixes are configurable, end-to-end.**
  - **WHAT** — Adding a suffix to `dusk.config.yml` makes paths ending in it resolve as test-pyramid children and pass gate check 9.
  - **HOW** — Set `test_pyramid.suffixes: [unit-tests, integration-tests, e2e-tests, contract-tests]`; author an `X/contract-tests` intent and decorate a test with `@intent-test X/contract-tests` → assert the graph resolves it as a test child of `X`, the test-discovery query keys it under the new layer, and the gate approves the decorator.
  - **WHY** — RFC §3.4; commitment row "Test pyramid via configurable suffixes".

- **P1-T18 · `@intent-ignore` enforces the controlled predicate vocabulary.**
  - **WHAT** — Opt-outs can only cite an approved ignore predicate, with both `because` and `reason`.
  - **HOW** — Write an ignore with predicate `is-generated-by` + reason → approve; write one with an out-of-vocabulary predicate → assert block with `invalid_ignore_predicate`; write one missing `reason` → assert `missing_ignore_reason`.
  - **WHY** — RFC §2.8, App. A.8.

- **P1-T19 · `dusk validate` reports malformed intents with `file:line` precision.**
  - **WHAT** — An author gets actionable, located errors rather than a generic failure.
  - **HOW** — Author an intent with a missing `obligation` and a triple missing `predicate` → assert `dusk validate` exits non-zero and names each defect with its `file:line`; fix them → assert exit 0.
  - **WHY** — RFC §2.1; roadmap Sprint 1 ("clear error messages with file:line locations").

- **P1-T20 · Interrupted write never leaves a corrupt `intent.yaml`.**
  - **WHAT** — Atomic write semantics mean a crash mid-write leaves the prior valid file, not a half-written one.
  - **HOW** — Simulate a failure between temp-write and rename → assert the on-disk `intent.yaml` is either the complete prior version or the complete new version, never a partial; assert the next `dusk validate` reads a valid file.
  - **WHY** — Roadmap Sprint 1 ("atomic-write semantics — write to temp + rename"). Protects the Author's Stage-5 commit.

- **P1-T21 · The gate warns on a write that references a superseded intent path.**
  - **WHAT** — The second half of the `supersedes` edge semantics (beyond Decomposer exclusion) is enforced at the write boundary.
  - **HOW** — With intent B carrying `relates_to: [{kind: supersedes, target: A}]`, feed a write decorated `@intent A` → assert the gate surfaces a warning naming A as superseded-by-B (non-blocking — a warning, not a `block`).
  - **WHY** — RFC §2.1 (`supersedes` row: "gate warns on writes that reference the superseded path"). Closes a typed-edge secondary-behavior gap the board flagged.

### Phase-landing smoke test

**Scenario — "substrate end-to-end on a fresh repo."** In a throwaway git repo: (1) `dusk init`; (2) drop the 6 canonical intents plus `notifications/send` + `notifications/send/unit-tests` into `.ia/intents/`; (3) `dusk validate` all → green; (4) write the App. B decorated `sendNotification` file through the **installed hook** → approve; (5) introduce one violation of each gate check in turn → each blocked with the correct typed rejection; (6) `dusk inspect notifications/send` → shows triples, obligation, typed `relates_to`, and a hierarchical-satisfaction view listing the `unit-tests` child as unsatisfied (no test code yet); (7) `dusk doctor --check-hook` → exit 0.

**Green means:** intents parse and validate, decoration parses, the index answers focal/support + rollup correctly, the real hook approves clean code and blocks all 10 violation classes, and init/doctor operate the hook surface. Phase 2 may start.

### Cohesive landing criteria

- [ ] All P1 behavioral tests pass against real file system + the real hook process.
- [ ] The phase-landing smoke test passes in a clean temp repo.
- [ ] `dusk init`, `dusk validate`, `dusk inspect`, `dusk doctor`, `dusk doctor --check-hook` all run with working `--help`.
- [ ] No carry-over: the index exposes all five query types (forward, reverse, focal/support, aspect-rollup, test-discovery) and satisfaction rollup — none stubbed.
- [ ] The 6 canonical intents parse, validate, and inspect; the negation-detector corpus is green; migration of a real v8 fixture is green.
- [ ] The gate is the *only* hook surface installed; `_dusk_marker` idempotency and conflict-prompt paths are all exercised.

---

## Phase 2 — Runtime + Read-Path Verification

Roadmap Sprints 3–4 (authored in parallel). This phase makes sub-agents spawnable and makes the system able to **verify** decorated code — without yet driving the write pipeline. It is the first phase where a model is in the loop, so it is where the Verifier's load-bearing behaviors (polarity inversion, deterministic antecedents, verdict split, scoped reading) become real and falsifiable.

### Outcome

An operator can point `dusk_verify` at a decorated diff or scope and get back accurate per-triple verdicts that **split focal correctness from support-decoration quality**, correctly **reject negative-polarity triples whose affirmative claim holds** (with the model never seeing negation), and **trivially accept `implies` intents whose antecedent is false without spending a single token on the consequent**. `dusk_inspect` reports hierarchical satisfaction and focal/support claim lists. All nine roles spawn via the Task tool with Dusk-materialized memory and skills, and the Verifier is provably fresh per call.

### Scope

- **9 role files under `.claude/agents/dusk-*.md`** with full v9 frontmatter (`dusk_role_version: 2`, `memory`, advisory `tools`, `skills`, `model`) and complete role-body content per RFC §9.5. The **`dusk-verifier.md` prompt template ships complete** — two-path execution structure for `compose: implies` ("antecedents already evaluated deterministically; you receive only consequents"), an explicit affirmative-framing contract (no "invert if negated" branch), and 2 positive + 2 negative few-shots drawn from App. B. (Sprint 3; RFC §9.1, §9.5, App. A.9.)
- **Tier-1 skills shipped complete** (`dusk/verifier/triple-evaluation`, `code-span-scoping`, `polarity-aware-evaluation`, `implies-evaluation`; `dusk/engineer/decoration-completeness`, `statement-extraction`; `dusk/author/polarity-decision`, `implies-antecedent-grammar`); Tier-2 skills shipped at baseline. (Sprint 3.)
- **`packages/runtime/orchestrator/spawn` — `spawnSubAgent({role, beadId?, dialogId?, sessionId, input})`** that materializes memory + injects skills **before** the Task call (`subagent_type: dusk-<role>`), and emits a `SubAgentTrace` (with `skills_loaded[]`, `iteration_number?`) on return. **Test-mode raw-prompt capture (NEW per board round 4):** in test/benchmark mode the spawn pipeline records the verbatim assembled system prompt to the trace's `raw_prompt` field (RFC App. A.6) — this is the observable surface the polarity, no-leak, and two-path tests assert against, replacing assertions on the lossy `input_summary`. The field is gated to test/benchmark mode for cost; production traces omit it. `index_snapshot_id` is present-but-**unset/optional** in this phase (no session snapshot exists until Phase 3), so Phase 2's landing gate is closeable without it. (Sprint 3; RFC §9.9, App. A.6.)
- **`packages/runtime/memory`** — materialization for all four scopes (`none`/`bead`/`dialog`/`session`), the **structured dual-channel bead-memory format** (§9.6.1) with **mechanical-only compaction** (never LLM-summarized), and **diagnosis routing to the Bead Orchestrator only** (never into the Verifier spawn payload). (Sprint 3; RFC §9.6, §9.6.1.)
- **`packages/runtime/skills`** + **`packages/runtime/tool-scope`** — advisory skill injection and advisory tool scoping (per §9.4/§9.7); the gate is the real boundary. (Sprint 3.)
- **`packages/runtime/verifier`** — the full §3.3 procedure: resolve focal+support claimants → read scoped evidence → **deterministic index-lookup antecedent evaluation for `implies`** → affirmative prompt build (with quantifier bound/scope) → LLM verdict → **runtime polarity inversion** → per-support `triple_verdict` (matches/mismatch/vague) → `support_quality` aggregation → per-`compose` aggregate. Output per App. A.4 (with `implies_antecedent_held?`, `focal_verdict` + `support_quality`, `support_pass_count`). Verifier spawned `memory: none` with **no iteration-specific or diagnosis content in its assembled payload** — the *behavioral* freshness property (the payload carries nothing that distinguishes iter N from iter 1) rather than byte-identity, which the §7.5 audit measures empirically. The antecedent-evaluation path **emits no Verifier Task call at all** when the antecedent is false. (Sprint 4; RFC §3.2.1, §3.3, App. A.4.)
- **`packages/delivery/mcp-server`** — MCP scaffolding + read-only tools `dusk_status`, `dusk_inspect`, `dusk_verify`, and the paired fallback tools `dusk_list_intents` / `dusk_get_intent` / `dusk_list_traces` / `dusk_list_beads` / `dusk_get_bead` / `dusk_list_implement_checkpoints`; read-only MCP **resources** for the same URIs; **`DuskError` envelope** on every tool. (Sprint 4; RFC §10.1, App. A.11.)
- **`packages/cli`** — `dusk verify`, `dusk inspect` mirrors; `dusk roles`, `dusk skills`. (Sprints 3–4.)

### Behavioral tests integrated in this phase

#### Spawn + memory + asymmetry

- **P2-T1 · Verifier is genuinely fresh — no context leak across spawns.**
  - **WHAT** — A second Verifier call cannot see anything from the first.
  - **HOW** — Spawn the Verifier on diff A, then on an unrelated diff B in the same session → assert B's captured `raw_prompt`, verdict, and trace contain **none of A's unique identifiers** (A's intent ids, A's file paths, A's quoted evidence spans) — a precise identifier check, not free-text fragment matching — and that B's assembled payload carries no field distinguishing it from a cold-session payload.
  - **WHY** — RFC §9.2, §9.6, §7.5; commitment row "Engineer ⊥ Verifier asymmetry — falsifiable + protected". *(Behavioral freshness is measured empirically by P5-T3; this test pins the structural no-leak invariant against the captured prompt, not against payload byte-identity.)*

- **P2-T2 · Engineer bead memory persists across iterations and stays bounded.**
  - **WHAT** — The Engineer accumulates structured cross-iteration context whose size does not grow with iteration depth.
  - **HOW** — Drive 20 iterations (via the scripted-verdict Verifier double) writing back to `engineer.md` → assert iter 20 reads a memory file in which the load-bearing sections (current diagnosis, approaches-tried, last-3 Verifier signals) survive compaction, older Verifier signals were compacted into "Approaches tried" preserving `triple_id`/`focal_verdict`/slot-focus while dropping only verbose rationale, and **`size(iter 20) ≈ size(iter 3)` within tolerance** (size does not grow with iteration depth) — rather than asserting an absolute byte cap or an exact section count.
  - **WHY** — RFC §9.6.1; commitment row "Sub-agent memory in frontmatter + structured dual-channel". *(Compaction is mechanical — assert no model call occurred during write-back.)*

- **P2-T3 · Diagnosis never reaches the Verifier.**
  - **WHAT** — The Engineer's convergence diagnosis informs orchestration but is invisible to the reviewer.
  - **HOW** — Seed a "Current diagnosis" block in bead memory, spawn the Verifier → assert the Verifier's captured `raw_prompt` contains **none** of the diagnosis text and its trace carries no diagnosis field, while `convergence_diagnosis_present` appears only on the Bead-Orchestrator trace.
  - **WHY** — RFC §6.4, §9.6.1, App. A.6 note; round-3 board fix (diagnosis-leak). This is the asymmetry the §7.5 audit later measures.

- **P2-T4 · Every spawn records its loaded skills.**
  - **WHAT** — Skill scope is auditable post-hoc even though it is advisory in v1.
  - **HOW** — Spawn the Engineer whose frontmatter lists three `dusk/engineer/*` skills → assert the emitted trace's `skills_loaded[]` names exactly those three.
  - **WHY** — RFC §9.7, App. A.6; commitment row "Sub-agent skills (advisory in v1)".

#### Verifier procedure (real model, curated fixtures)

- **P2-T5 · Polarity inversion at runtime — the LLM never sees negation, and the inversion truth-table holds.**
  - **WHAT** — `polarity: negative` flips the verdict correctly in **both** directions, and the model is only ever asked the affirmative question — proving the runtime *inverts*, not merely that the prompt is affirmative.
  - **HOW** — Run the 2×2 {polarity: negative, positive} × {affirmative claim holds, doesn't hold} over fixtures: negative-polarity + code that *does* offset pagination → `focal_verdict:"fail"`; negative-polarity + code that does **not** → `focal_verdict:"pass"`; positive-polarity duals → the inverse — proving "always invert" and "correctly invert" are distinguishable. In every case assert the captured `raw_prompt` poses the affirmative question with **no** `does NOT` / negation substring. Include one fixture where a constituent-negation NP (`"…with no required arguments"`) rides in the object slot of a negative-polarity triple → assert the runtime still distinguishes constituent from matrix negation (no false reframing).
  - **WHY** — RFC §3.1, §3.3, App. D.17; commitment row "Polarity field on triples". *(2×2 + constituent case added per board round 4: substring-absence alone proved framing, not inversion.)*

- **P2-T6 · Deterministic antecedent — no Verifier call when the antecedent is false.**
  - **WHAT** — An `implies` intent whose antecedent does not hold is accepted without evaluating — or paying for — the consequent.
  - **HOW** — Run `dusk_verify` on a function lacking the `api/write-endpoint` decoration against `api/idempotency-on-writes` (antecedent `"is decorated with api/write-endpoint"`) → assert `decision:"accept"`, `implies_antecedent_held:false`, `per_triple:[]`, and — the primary, refactor-robust assertion — **no `SubAgentTrace` of role `verifier` is emitted for the consequent** (the antecedent was decided by index lookup); the antecedent-phase prompt-token sum being `0` is asserted as corroboration only.
  - **WHY** — RFC §3.2.1, App. A.4, App. D.18; commitment row "`compose: implies` with deterministic antecedents".

- **P2-T6b · All three antecedent predicates evaluate by index lookup.**
  - **WHAT** — Not just `"is decorated with"` but the full closed antecedent vocabulary is deterministically evaluated.
  - **HOW** — Build one `implies` intent per closed predicate — `"claims any aspect of <path>"` and `"is enclosed by a decoration of <path>"` (the latter resolving an enclosing file/dir scope, a distinct index query) — and run each against a unit that holds and one that doesn't → assert correct `implies_antecedent_held` and **no Verifier call** in the antecedent phase for all of them.
  - **WHY** — RFC §3.2.1 (closed-vocabulary table); commitment row "`compose: implies` with deterministic antecedents". Closes the "only `is decorated with` is tested" gap.

- **P2-T6c · A negative-polarity antecedent triple is a set-complement query.**
  - **WHAT** — `polarity: negative` on an antecedent triple inverts the *index-lookup* sense ("the unit is NOT decorated with X"), composing the two hardest features correctly.
  - **HOW** — Author an `implies` intent whose antecedent is `{predicate:"is decorated with", object:"api/legacy", polarity:negative}` → assert a unit **not** decorated `api/legacy` makes the antecedent hold (consequent fires) and a unit **decorated** `api/legacy` makes it false (vacuous accept), with no LLM call either way.
  - **WHY** — RFC §3.2.1 (step 3, set-complement); commitment rows "Polarity field on triples" + "`compose: implies` with deterministic antecedents".

- **P2-T7 · Antecedent true → consequents are LLM-evaluated.**
  - **WHAT** — When the antecedent holds, the rule actually fires on the consequent.
  - **HOW** — Decorate the same function with `api/write-endpoint` but omit idempotency handling → assert `implies_antecedent_held:true` and the idempotency consequent triple's `focal_verdict:"fail"`.
  - **WHY** — RFC §3.2.1, §3.3. Together with P2-T6 this proves the antecedent is a gate, not a vacuous pass.

- **P2-T7b · An ambiguous antecedent is a structural error, never an LLM fallback.**
  - **WHAT** — When the antecedent's unit-under-evaluation can't be uniquely resolved, the Verifier returns a structural error rather than silently letting the LLM guess — the guarantee that protects `must`-rules from silent vacuous satisfaction.
  - **HOW** — Feed an `implies` intent whose subject binds ambiguously to the unit-under-evaluation → assert `DuskError{kind:"verifier_evidence_too_large"}` (or the structural-failure path) and **zero LLM calls in the antecedent phase**; assert there is no path where the antecedent is LLM-judged.
  - **WHY** — RFC §3.2.1 (ambiguity handling, "no LLM fallback for antecedents"); commitment row "`compose: implies` with deterministic antecedents". Closes the no-LLM-fallback coverage gap.

- **P2-T8 · Verdict split — focal drives, support is advisory; mismatch and vague both surface.**
  - **WHAT** — A wrong or under-specified support triple lowers `support_quality` but does not by itself fail the focal verdict, a real focal defect fails regardless of pristine supports, and the low-confidence signal reaches its documented consumer.
  - **HOW** — On code satisfying the focal claim but carrying one `@intent-support` triple that misdescribes its statement → assert `focal_verdict:"pass"`, `support_quality:"low_confidence"`, that claim's `triple_verdict:"mismatch"`; on code whose support triple is underspecified → assert a real `triple_verdict:"vague"` from the model (exercising the ≥50%-vague path, not just the rule in P2-T9); on code with a real focal defect but accurate supports → assert `focal_verdict:"fail"`, `support_quality:"ok"`. Then `dusk_inspect` the low-confidence case → assert the low-confidence support **appears in the inspect report** (its documented consumer), not just in the verdict.
  - **WHY** — RFC §3.3, App. A.4; commitment row "Verifier verdict split: focal_verdict + support_quality". *(vague-path + inspect-surfacing added per board round 4.)*

- **P2-T9 · `support_quality` aggregation rule. (unit-only)**
  - **WHAT** — The advisory quality signal is computed deterministically from per-claim verdicts.
  - **HOW** — Over enumerated `triple_verdict` mixes assert: any `mismatch` → `low_confidence`; ≥50% `vague` → `low_confidence`; otherwise `ok`.
  - **WHY** — RFC §3.3, App. A.4. *Unit-only justification:* pure aggregation with no I/O; P2-T8 exercises it through the real procedure.

- **P2-T10 · Scoped reading — the Verifier sees ~4 lines, not the body.**
  - **WHAT** — Per-aspect verification reads only focal + support evidence.
  - **HOW** — Verify `notifications/send [publish-sync-per-insert]` on App. B → assert the Verifier input contains the publish line + loop/timestamp/event-payload supports and **not** the opt-out, push-dispatch, or error-handling lines.
  - **WHY** — RFC §3.3, §4.2, App. B.4; commitment row "Decoration is total" (the scoping payoff).

#### Read-path MCP surface

- **P2-T11 · `dusk_inspect` reports correct hierarchical satisfaction + claim lists.**
  - **WHAT** — The read-only inspect surface mirrors the index truthfully.
  - **HOW** — Inspect `notifications/send` over the App. B fixture → assert `claims`, `support_claims`, `aspects_unsatisfied`, and `test_intents` match the index, and the unit-tests child shows unsatisfied until test code exists.
  - **WHY** — RFC §10.1, §2.9; roadmap Sprint 4 checkpoint.

- **P2-T12 · `dusk_verify` produces accurate per-triple verdicts on the worked example.**
  - **WHAT** — The canonical clean-decoration file verifies as the RFC intends.
  - **HOW** — `dusk_verify` the App. B file with no injected defects → assert every focal triple passes (incl. the negative-polarity and `implies` cases) and the call mutates no state and produces no commit.
  - **WHY** — RFC App. B; roadmap Sprint 4 checkpoint.

- **P2-T13 · Resources and paired tools return the same data.**
  - **WHAT** — Hosts with or without resource browsing see the same intents/traces/beads.
  - **HOW** — Read `dusk://intents` and call `dusk_list_intents` → assert **structural equality after parse** (same set of intent ids and fields), not byte-identity (which would couple the test to serializer formatting); same for one intent via resource vs `dusk_get_intent`.
  - **WHY** — RFC §10.1; commitment row "MCP resources + paired fallback tools". *(Reframed off byte-equivalence per board round 4.)*

- **P2-T14 · Every tool returns a `DuskError` on failure, not a throw.**
  - **WHAT** — The MCP envelope is uniform.
  - **HOW** — Call `dusk_get_intent` with an unresolvable path and `dusk_verify` with an oversized evidence scope → assert each returns a typed `DuskError` (`intent_path_unresolved`, `verifier_evidence_too_large`) with `recoverable` set, not an exception.
  - **WHY** — RFC App. A.11; commitment row "`DuskError` envelope on every MCP tool".

#### Quantifiers, composition modes, and the Verifier template

- **P2-T15 · Cardinality is checked against the `quantifier` field, not parsed from English.**
  - **WHAT** — Quantified triples reject on the wrong count and accept on the right one.
  - **HOW** — Verify a triple `{quantifier: exactly-one, scope:"per inserted notification row"}` against code that publishes twice per row → assert `focal_verdict:"fail"`; against code publishing once per row → assert pass; repeat for `each` and `at-least-2` to assert the bound is enforced explicitly.
  - **WHY** — RFC §3.1, §3.3; commitment row "Quantifier vocabulary on triples".

- **P2-T15b · The `≤`-direction quantifiers (`none`, `at-most-one`, `at-most-N`) are enforced.**
  - **WHAT** — The error-prone inverted-cardinality family is checked, not just the existential/`≥` ones.
  - **HOW** — `none` → fail on ≥1 matching occurrence, pass on 0; `at-most-one` → pass on 0/1, fail on 2; `at-most-2` → pass at the boundary, fail at 3.
  - **WHY** — RFC §3.1 (quantifier table); commitment row "Quantifier vocabulary on triples". Closes the untested `≤`/`none` family.

- **P2-T15c · `scope` binds the quantifier — same code, different scope, different verdict.**
  - **WHAT** — `scope` is consumed, not decorative; it changes what the cardinality is counted over.
  - **HOW** — Verify the *same* code against two intents differing only in `scope` (`exactly-one` "per row" vs "per request") → assert the two yield different verdicts, proving the bound is evaluated against the named scope.
  - **WHY** — RFC §3.1, §3.3; commitment row "Quantifier vocabulary on triples … optional `scope:`".

- **P2-T16 · `compose` aggregation modes combine per-triple verdicts correctly.**
  - **WHAT** — `all`/`any`/`none`/`implies` produce the right intent-level `decision`.
  - **HOW** — On the same triple verdicts assert: `all` rejects if any focal fails; `any` accepts if one passes; `none` rejects if any holds; `implies` accepts vacuously when the antecedent is false (per P2-T6) and otherwise reduces to `all` over consequents.
  - **WHY** — RFC §3.2, App. A.4.

- **P2-T17 · The Verifier prompt presents only consequents for an `implies` intent.**
  - **WHAT** — For a `compose: implies` intent the Verifier is asked only about consequents — the observable structural property — rather than a brittle exact-prose match.
  - **HOW** — Inspect the captured `raw_prompt` for an antecedent-true `implies` intent → assert it presents the **consequent triples and zero antecedent triples** for judgment (a structural property of the payload that survives prompt-wording refactors); the presence of the two-path framing is a secondary soft check, not the assertion.
  - **WHY** — RFC §3.2.1, §9.5; commitment row "Verifier prompt template with two-path execution structure". *(Reframed off exact-string match per board round 4.)*

- **P2-T18 · Passing supports are summarized as a count, not enumerated.**
  - **WHAT** — Trace volume stays bounded by default.
  - **HOW** — Verify an aspect with several accurate support claims → assert the verdict carries `support_pass_count` and enumerates only failed/low-confidence supports in `support_claims[]`.
  - **WHY** — RFC §3.3, App. A.4.

#### Spawn guards and status

- **P2-T19 · The runtime refuses to spawn a role outside the supported version range.**
  - **WHAT** — An incompatible role file is rejected rather than mis-spawned.
  - **HOW** — Set a role file's `dusk_role_version` outside the supported range and attempt a spawn → assert the spawn refuses with a clear error and emits no Task call.
  - **WHY** — RFC §9.5 ("runtime refuses to spawn a role whose `dusk_role_version` is outside the supported range").

- **P2-T20 · `dusk_status` returns the documented shape before any pipeline has run.**
  - **WHAT** — The status surface is well-formed and honest about an idle system.
  - **HOW** — Call `dusk_status` on a fresh server → assert `{active_beads, recent_verdicts, recent_test_runs, index_stats}` with empty collections and real `index_stats`, not a `DuskError`.
  - **WHY** — RFC §10.1.

### Phase-landing smoke test

**Scenario — "verify the worked example through the real MCP + real model."** Bring up the Dusk MCP server against a repo containing the App. B decorated `sendNotification` plus its intents (including one negative-polarity triple and the `api/idempotency-on-writes` `implies` intent). Call `dusk_verify` over the file in two passes: (a) clean → all focal verdicts pass, the negative-polarity triple passes (affirmative claim correctly absent), the `implies` antecedent-false intent returns `accept` with `implies_antecedent_held:false` and **no Verifier call for the consequent**; (b) with three injected defects (a real focal violation, a mismatched support triple, and an idempotency omission on a `write-endpoint`-decorated function) → the focal defect fails its `focal_verdict`, the mismatch surfaces as `support_quality: low_confidence`, and the consequent fails with `implies_antecedent_held:true`. Across both passes, a spawn audit confirms every Verifier call ran `memory: none` with **no iteration-specific or diagnosis content in its captured `raw_prompt`**.

**Green means:** the verification read-path is correct and the Verifier's four load-bearing behaviors (polarity inversion, deterministic antecedents, verdict split, scoped reading) hold against the real model. Phase 3 may start.

### Cohesive landing criteria

- [ ] All P2 behavioral tests pass against the real model + real MCP server + real file system.
- [ ] The phase-landing smoke test passes.
- [ ] `dusk_verify` / `dusk_inspect` (and their CLI mirrors) plus the six paired read-only tools and `dusk_status` are operable; `dusk verify --help` / `dusk inspect --help` work.
- [ ] No carry-over: the Verifier procedure is complete (no stubbed antecedent path, no flat verdict) and all 9 role files ship with real content incl. the complete Verifier template with few-shots.
- [ ] Spawn audit proves `memory: none` freshness and diagnosis non-leakage; bead memory is dual-channel with mechanical compaction and stays bounded over 20 iterations.

---

## Phase 3 — Implementation Pipeline

Roadmap Sprints 5–7 (sequential). This phase wires the full 9-step `dusk_implement` pipeline: decomposition + worktrees + short cycle (Sprint 5), long cycle + test execution (Sprint 6), commit + merge + return (Sprint 7). It is the largest phase and carries the most board-hardened machinery — session snapshots, the stuckness detector, the 40-iter budget + recovery ladder, N=10 long cycle with confirmation, two-stage test satisfaction with livelock detection, pause/resume, and cooperative cancel.

### Outcome

An operator (or harness) can issue `dusk_implement({request})` against a repo with pre-authored intents and get **one atomic commit per bead on main**, each carrying full intent/test/verdict trailers, produced through a short cycle that diagnoses its own stuckness early without ever contaminating the Verifier, a long cycle that catches regressions at N=10 while filtering Verifier flake via a confirmation pass, and a test step that refuses tests which don't actually verify their claims. Parallel beads run in isolated worktrees and merge topologically. The run can be **paused** for missing intents (resumable via `resume_token`), **partially committed** when the budget exhausts with some intents satisfied, and **cooperatively cancelled** with an honest accounting of what was cleaned vs preserved.

### Scope

- **`packages/runtime/orchestrator`** — Root Orchestrator (session memory) + Bead Orchestrator (bead memory); **session-snapshot index** built once at pipeline entry from `origin/main`, immutable for the run, hashed onto every trace as `index_snapshot_id`; per-bead in-memory delta visible only to that bead; `--rebuild-index`. (Sprint 5; RFC §2.10.)
- **`packages/runtime/decomposer`** — Step 1 request decomposition (typed `relates_to` walking: `implies`→auto-add, `conflicts`→hard refusal, `supersedes`→exclude, `parent`/path→scope+edge, `sibling`→context-only, no auto-expand; auto-add test-pyramid children); Step 2 bead DAG with **file-overlap serialization edges** and the **cross-bead claim-overlap precondition** (focal overlap → hard `decomposer_bead_conflict`; support overlap → advisory warning). Unresolved-intent → **disk checkpoint + `implement_paused_for_authoring`**. (Sprint 5; RFC §6.2, §8.9, §10.1.1.)
- **`packages/runtime/implement-checkpoint`** — checkpoint format/read/write/GC; `resume_token` (`rt_…`), 24h TTL, single-use. **The checkpoint JSON shape is the frozen cross-proposal interface (NEW per board round 4):** Phase 3 pins the full RFC §10.1.1 field set — `{original_request, scope_hint, decomposer_partial_state, intents_resolved_so_far, intents_still_unresolved, suggested_dialog_seed, unresolved_refs, created_at, last_touched_at}` — because the Phase 4 Author proposal *consumes* this file. Phase 3 ships `suggested_dialog_seed` present-but-naive (the raw unresolved-ref list); Phase 4 enriches its *content* without changing its *shape*. (Sprint 5; RFC §10.1.1.)
- **`packages/runtime/worktree`** — Step 3 parallel/serial decision; `git worktree add -b dusk/<bead-id>`; orphan cleanup via `dusk doctor --cleanup-worktrees`. (Sprint 5; RFC §6.3.)
- **`packages/runtime/short-cycle` + `packages/runtime/recovery-ladder`** — Step 4 loop: **stuckness detector** (3-iter window, fires diagnosis as early as iter 3) + **iter-5 fallback** + **iter-15 early escalation**; gate-fail and `focal_verdict:fail` loopbacks; fresh-Verifier-per-iter whose payload carries no iteration-specific content; per-`dusk.config.yml` **per-entry ceiling (default 20) and 40-iter lifetime budget**; **the complete 4-level Recovery Ladder — L1 partial commit → L2 intent-modification proposal → L3 operator-actionable freeze → L4 hard abort (NEW per board round 4: all four levels now land here, not split to Phase 5).** Moving the whole ladder into Phase 3 removes the semantic contradiction where a zero-satisfiable bead would hard-abort (`recoverable:false`) in Phase 3 but should be `bead_intent_revision_needed` (`recoverable:true`) per RFC §6.4.1. L2's *recovery action* (`dusk_author_continue`) lands in Phase 4, but L2's *artifact* (`intent-proposal.yaml` + the recoverable error) and L3's freeze artifact + `dusk implement --resume` plumbing are fully produced and tested here. (Sprint 5; RFC §6.4, §6.4.1, §6.4.2.)
- **`packages/runtime/long-cycle`** — Step 5 affected-universe (direct ∪ adjacent, snapshot-only); **N=10** sampling; **N=2 confirmation pass on first reject** (`confirmation_of_trace_id`; ≥1/2 confirm → regression + re-enter Step 4; both override → `flaky_verdict_dismissed` + continue). (Sprint 6; RFC §6.5, App. D.3.)
- **`packages/runtime/test-runner`** + **`packages/runtime/livelock-detection`** — Step 6 **two-stage satisfaction** (Verifier pre-pass on test bodies before any execution; only verified tests run), Vitest invocation with scoped file list, per-test-intent `TestVerdict`; **Test-Verifier livelock detector** (same triple ≥3 iters + slot-focus ≥80% + ≥3 structural approaches) → `TestVerifierLivelockReport`; `dusk_resolve_livelock` (three verbs). (Sprint 6; RFC §3.4, §3.4.1, §6.6, App. A.5.)
- **`packages/runtime/commit` / `merge` / `conflict-resolver`** — Step 7 atomic commit with all trailers (incl. `Partial`, `Deferred-Intent`, `Test-Verdict-id`, `Verifier-bypassed-test-intent`); Step 8 topological rebase recognizing `Partial: true`; **decorator-aware Conflict Resolver**; Step 9 return summary. (Sprint 7; RFC §6.7–6.9, App. A.7.)
- **`packages/runtime/cancel`** — `dusk_cancel` cooperative semantics: flag → drain in-flight Task calls → ordered cleanup → `CancelResult` distinguishing `cancelled[]` from `preserved[]`. (Sprint 5; RFC §10.1.2, App. A.11.)
- **MCP/CLI** — `dusk_implement({request? | resume_token?, scope_hint?})`, `dusk_cancel`, `dusk_resolve_livelock`, `/dusk-test`; `dusk implement` CLI mirror. (Sprints 5–7.)

### Behavioral tests integrated in this phase

#### Session snapshot + decomposition

- **P3-T1 · Cross-bead reads see the snapshot; same-bead sees snapshot ∪ delta.**
  - **WHAT** — Parallel beads reason against a single immutable base, while a bead sees its own in-flight writes.
  - **HOW** — Start a 2-bead run; have bead A write a new decoration to its worktree → assert bead B's Decomposer/long-cycle/overlap queries do **not** observe A's decoration, while A's own Verifier does; assert every trace carries the same `index_snapshot_id`; run `--rebuild-index` → assert a new snapshot id.
  - **WHY** — RFC §2.10; commitment row "Session-snapshot derived index".

- **P3-T2 · Typed `relates_to` drives decomposition semantics.**
  - **WHAT** — Each edge kind produces its specified scheduling/scope behavior.
  - **HOW** — On a request touching intent X: with X `implies` Y assert Y enters the active set automatically; with X `conflicts` Z (both touched) assert the run returns `decomposer_bead_conflict` and issues **no** beads for the pair; with X `supersedes` W assert W is excluded; with a child of X touched assert X is pulled into scope via `parent`; with X `sibling` S assert **S does not enter scope** (context-only, no auto-expand).
  - **WHY** — RFC §2.1, §6.2; commitment rows "Typed `relates_to` edges" + roadmap construction note 11. *(sibling negative-assertion added per board round 4.)*

- **P3-T3 · File-overlap edges serialize would-be parallel writers.**
  - **WHAT** — Two beads whose predicted file impact overlaps are sequenced, not run in parallel.
  - **HOW** — Construct two intents whose claimants share a file (e.g., a cross-cutting `observability` bead and an impl bead touching the same module) → assert the DAG contains a serialization edge and the two beads do not get concurrent worktrees on that file.
  - **WHY** — RFC §6.2; commitment row "File-overlap edges in Bead DAG".

- **P3-T4 · Cross-bead claim overlap: focal hard-refuses, support warns.**
  - **WHAT** — Two beads cannot produce conflicting focal claims; overlapping support claims are surfaced but non-blocking.
  - **HOW** — Force two beads that would both write focal `@intent X [a]` → assert `decomposer_bead_conflict` (no DAG issued); force two beads that would both write `@intent-support X [a]` on the same region → assert the DAG issues **and** the run summary carries an advisory overlap warning.
  - **WHY** — RFC §6.2, §8.9; commitment row "Cross-bead claim overlap prevention — focal+support".

#### Pause / resume

- **P3-T5 · Unresolved intent pauses the pipeline with a resumable token.**
  - **WHAT** — A missing intent halts cleanly with everything needed to resume after authoring.
  - **HOW** — `dusk_implement({request})` referencing an unauthored behavior → assert it returns `DuskError{kind:"implement_paused_for_authoring", details.resume_token, details.unresolved_refs}`, and `.ia/runtime/implement/<resume_token>.json` exists with `original_request`.
  - **WHY** — RFC §10.1.1; commitment row "`dusk_implement` pause/resume contract".

- **P3-T6 · Resume continues from Step 1 and consumes the checkpoint.**
  - **WHAT** — After the intent exists, the same run resumes and the checkpoint is single-use.
  - **HOW** — Author the missing intent out-of-band, call `dusk_implement({resume_token})` → assert the Decomposer re-runs the unresolved-ref check, proceeds to Step 2, and the checkpoint file is deleted as the pipeline leaves Step 1.
  - **WHY** — RFC §10.1.1.

- **P3-T7 · Expired token returns an actionable error preserving the original request.**
  - **WHAT** — A stale resume fails honestly with enough to retry.
  - **HOW** — Age a checkpoint past 24h, call `dusk_implement({resume_token})` → assert `DuskError{kind:"implement_resume_token_expired", recoverable:false}` whose `recovery_hint` quotes the original request.
  - **WHY** — RFC §10.1.1.

#### Short cycle: stuckness, escalation, recovery ladder

- **P3-T8 · Stuckness detector fires early; asymmetry preserved.**
  - **WHAT** — Three iterations of a stable failing-triple set trigger exactly one diagnosis at iter 3 (not iter 5), written only to the Engineer's bead memory, with no diagnosis content reaching the Verifier.
  - **HOW** — Drive the bead through the **scripted-verdict Verifier double** (no model calls) so iters 3–5 deterministically share an empty `verdict_delta_from_prior` and an identical `failing_triple_set` → assert one "Current diagnosis" write at iter 3, `stuckness_detector_state.fired:true` on the Bead-Orchestrator trace, and **no** Verifier `raw_prompt` containing diagnosis content across iters (the structural no-leak invariant — not payload byte-identity). An integration leg additionally derives `failing_triple_set` from real (temp-0) Verifier verdicts on a genuinely-stalling fixture, to prove the upstream derivation is wired, not just the predicate.
  - **WHY** — RFC §6.4.2, §6.4, §9.6.1; commitment rows "Stuckness detector + iter-5 fallback + iter-15 escalation" and the asymmetry row. *(Scripted-driver + raw_prompt reframing + derivation leg added per board round 4.)*

- **P3-T9 · Iter-5 fallback fires the diagnosis when stuckness hasn't.**
  - **WHAT** — Even with a moving failing-triple set, the Engineer is forced to articulate the blocker by iter 5.
  - **HOW** — Via the scripted-verdict Verifier double, drive a bead whose failing set changes each iter (stuckness never fires) and never converges → assert a diagnosis is written exactly at iter 5.
  - **WHY** — RFC §6.4, §6.4.2.

- **P3-T10 · Iter-15 escalation surfaces the diagnosis as payload.**
  - **WHAT** — A long-tail non-converging bead escalates to the user with the diagnosis, not a bare failure.
  - **HOW** — Via the scripted-verdict Verifier double, drive 15 non-converging iters → assert escalation to the user whose payload is the bead-memory diagnosis (read from memory, not from any Verifier-visible state).
  - **WHY** — RFC §6.4.

- **P3-T11 · Recovery Ladder Level 1 partial commit lands.**
  - **WHAT** — At lifetime-budget exhaustion with intent A satisfied and B not, exactly one commit ships A and defers B.
  - **HOW** — Via the scripted-verdict Verifier double, drive a two-intent bead to lifetime exhaustion with A verifiable, B not → assert one commit on the branch with `Partial: true` and `Deferred-Intent: B` trailers, A's `Intent:` trailer present, B's absent, `deferred.yaml` written, and Step 8 merges it to main with no `snapshot_drift` warning for the deferred-intent additions.
  - **WHY** — RFC §6.4.1, §2.10; commitment row "Per-bead 40-iter lifetime budget + 4-level recovery ladder".

- **P3-T12 · Recovery Ladder Level 2 produces a recoverable intent-modification proposal.**
  - **WHAT** — Exhaustion with **zero** satisfiable intents (and partial commit invalid) yields a *recoverable* proposal — not a hard abort — matching the RFC's deterministic cascade.
  - **HOW** — Via the scripted-verdict Verifier double, drive a bead to exhaustion with no intent satisfiable and partial commit invalid → assert `.ia/runtime/beads/<bead-id>/intent-proposal.yaml` is written aggregating **all** lifetime diagnoses (which triple seems unsatisfiable, proposed affirmative rephrasings, scope-narrowings), and `DuskError{kind:"bead_intent_revision_needed", recoverable:true}` whose `recovery_hint` points at `dusk_author_continue`.
  - **WHY** — RFC §6.4.1; commitment row "Per-bead 40-iter lifetime budget + 4-level recovery ladder (ALL FOUR LEVELS)". *(Corrects the round-3 plan defect where this state hard-aborted; the full ladder now lands in Phase 3.)*

- **P3-T12b · Recovery Ladder Level 3 freezes operator-actionably and resumes.**
  - **WHAT** — When Level-2 proposal generation itself fails, the bead freezes with preserved state and resumes after manual fix.
  - **HOW** — Force Level-2 generation to fail → assert the worktree is preserved, `freeze-state.md` carries bead memory + last 3 verdicts + diagnosis history, and `DuskError{kind:"bead_frozen", recoverable:false}` is returned; then `dusk implement --resume <bead-id>` → assert the bead resumes from the preserved state.
  - **WHY** — RFC §6.4.1; commitment row "… 4-level recovery ladder (ALL FOUR LEVELS)".

- **P3-T12c · Recovery Ladder Level 4 hard-aborts only when freeze can't serialize.**
  - **WHAT** — The non-recoverable abort fires for its *actual* RFC trigger (freeze-state unwritable), not for "nothing satisfiable."
  - **HOW** — Force the Level-3 freeze write to fail (disk error) → assert `DuskError{kind:"bead_aborted", recoverable:false}`.
  - **WHY** — RFC §6.4.1 (Level 4 = "Level 3 cannot serialize freeze state"). Pins the corrected ladder trigger.

#### Long cycle

- **P3-T13 · Clean diff yields N=10 verdicts; no false regression.**
  - **WHAT** — A regression-free change samples the universe and passes.
  - **HOW** — Run Step 5 on a clean bead over a universe ≥10 → assert exactly 10 sampled verdicts, all accept, and progression to Step 6.
  - **WHY** — RFC §6.5, App. D.3; commitment row "Long-cycle N=10 + N=2 confirmation pass on reject".

- **P3-T14 · Confirmation pass confirms a real regression (mechanism).**
  - **WHAT** — When the first sample and ≥1 confirmation agree on reject, the bead re-enters Step 4.
  - **HOW** — Drive Step 5 with the scripted-verdict Verifier double returning the sequence `[reject, reject, accept]` on a sampled tuple → assert two confirmation calls fire (`confirmation_of_trace_id` set), `confirmation_pass_outcome:"confirmed_reject"`, a regression report, and re-entry to Step 4 with the regressed intent added.
  - **WHY** — RFC §6.5; commitment row "Long-cycle N=10 + N=2 confirmation pass".

- **P3-T15 · Confirmation pass dismisses a flaky reject (mechanism).**
  - **WHAT** — A first-call reject that both confirmations override is treated as noise, not a regression.
  - **HOW** — Drive Step 5 with the scripted-verdict Verifier double returning `[reject, accept, accept]` on the sampled tuple → assert the bead does **not** re-enter Step 4, the original event carries `confirmation_pass_outcome:"flaky_verdict_dismissed"`, all three share `confirmation_of_trace_id`, and sampling continues. *(Tests the dismissal control logic deterministically — a real model cannot be made to reliably reject-then-accept-twice on demand, so the orchestration, not the model, is the unit under test.)*
  - **WHY** — RFC §6.5, §7.5.1; round-3 board fix (false-positive amplification). *(Reframed onto the Verifier double per board round 4; the real-model flake *rate* is characterized non-gating in Phase 5, not asserted here.)*

#### Test execution + livelock

- **P3-T16 · Two-stage satisfaction rejects a test that verifies nothing — before it runs.**
  - **WHAT** — A trivially-passing test annotated `@intent-test covers-X` fails the Verifier pre-pass and never reaches the Test Runner.
  - **HOW** — Provide a test body `db.insert(...); pubsub.publish(...); expect(true).toBe(true)` annotated `covers-persist-first` → assert the Verifier rejects it and the Test Runner is not invoked on it (the bead bounces to Step 4 to fix the test).
  - **WHY** — RFC §3.4; commitment row "Two-stage test-intent satisfaction + livelock detection".

- **P3-T17 · Verified tests execute and roll up to a `TestVerdict`.**
  - **WHAT** — Tests that pass the Verifier run under Vitest and produce per-test-intent verdicts.
  - **HOW** — Provide real passing unit tests for `notifications/send/unit-tests` → assert the Test Runner invokes `pnpm vitest` with the scoped file list, captures pass/duration per test, and emits a `TestVerdict` with each `covers-X` triple satisfied.
  - **WHY** — RFC §3.4, §6.6, App. A.5.

- **P3-T18 · Livelock surfaces a structured report and resolves three ways.**
  - **WHAT** — A persistently-unverifiable test triple produces a `TestVerifierLivelockReport` and the user can resolve it.
  - **HOW** — Via the scripted-verdict Verifier double, drive: same `(test_intent, triple)` rejected ≥3 consecutive iters with slot-focus ≥80% on `predicate` and ≥3 distinct taxonomy approaches → assert a `TestVerifierLivelockReport` with the failing triple, slot-focus distribution, and three suggested resolutions; then `dusk_resolve_livelock({verb:"accept_test_as_is"})` → assert the bead commits with a `Verifier-bypassed-test-intent` trailer naming the triple; `modify_triple` → assert a scoped author continuation opens keyed to the triple; `escalate` → assert a Level-3 freeze artifact is produced.
  - **WHY** — RFC §3.4.1; commitment rows "Two-stage … + livelock detection" and "`dusk_resolve_livelock` (three verbs)".

#### Commit, merge, cancel

- **P3-T19 · Atomic commit carries the full v9 trailer set.**
  - **WHAT** — Each bead produces exactly one commit with complete provenance trailers.
  - **HOW** — Run a bead to clean completion → assert one commit whose trailers include `Intent`, `Test-Intent`, `Bead-id`, `Verdict-id`, `Trace-id`, `Test-Verdict-id`, `Verifier-model`, `Test-Runner-model`, `Long-cycle-samples`, `Test-Suites-passed` (and `Partial`/`Deferred-Intent`/`Verifier-bypassed-test-intent` only when produced via the relevant path).
  - **WHY** — RFC §6.7, App. A.7.

- **P3-T20 · Parallel beads merge topologically; Conflict Resolver prefers specificity.**
  - **WHAT** — Worktree branches rebase in DAG order, and a decorator conflict resolves toward the more-specific decoration.
  - **HOW** — Run two parallel beads, then a synthetic rebase conflict on a decorated region → assert branches rebase in topological order and the Conflict Resolver keeps the side with more aspect ids / more granular path, surfacing equal-specificity ties as TODOs.
  - **WHY** — RFC §6.8; roadmap Sprint 7.

- **P3-T21 · Return summary contains all required fields.**
  - **WHAT** — Step 9 reports a complete machine-readable summary.
  - **HOW** — On a successful multi-bead run assert the return has `commits[]`, `beads_summary[]`, `intents_touched[]`, `test_intents_executed[]`, `trace_ids[]`, `total_duration_ms`, `total_cost_usd`.
  - **WHY** — RFC §6.9.

- **P3-T22 · `dusk_cancel` drains, cleans in order, and distinguishes cleaned from preserved.**
  - **WHAT** — Cooperative cancel preserves already-committed work and worktrees-with-commits while removing the rest, and reports honestly.
  - **HOW** — Mid-run, with bead A already merged, bead B holding a worktree commit, and bead C with an empty worktree, call `dusk_cancel` → assert a `CancelResult` where C is in `cancelled.cancelled_worktrees`, B is in `cancelled.partial_commits` (branch kept), A is in `preserved.already_committed`, `in_flight_tasks_drained ≥ 0`, and dialogs/checkpoints/bead-memories for cancelled beads are deleted.
  - **WHY** — RFC §10.1.2, App. A.11; commitment row "`dusk_cancel` cooperative semantics".

#### Worktree decision, loopbacks, budgets, universe, and standalone test

- **P3-T23 · Parallel vs serial worktree decision follows the DAG.**
  - **WHAT** — Independent beads get isolated worktrees; dependency/file-overlap-linked beads run in sequence in place.
  - **HOW** — Issue a DAG with two independent beads and one pair linked by a serialization edge → assert the independent pair gets two `dusk/<bead-id>` worktrees off `origin/main` while the linked pair runs serially without a second worktree on the shared file.
  - **WHY** — RFC §6.3, §6.2.

- **P3-T24 · Gate-fail loopback re-drafts without spending a Verifier call.**
  - **WHAT** — A write blocked by the PreToolUse gate routes back to the Engineer to fix, and the Verifier is only spawned once the gate passes.
  - **HOW** — Force the Engineer to emit an undecorated statement → assert the gate blocks, the rejection reaches the Engineer, it re-drafts, and **no** Verifier trace is emitted for the blocked draft (Verifier spawns only on gate pass).
  - **WHY** — RFC §6.4 (steps d–e); commitment row "PreToolUse gate" + short-cycle structure.

- **P3-T25 · The per-entry ceiling and the lifetime budget are distinct (config-driven).**
  - **WHAT** — A single Step-4 entry is bounded by `sanity.short_cycle_max_iterations`, while total iterations across re-entries are bounded by `sanity.bead_lifetime_iterations` — and the test asserts the *relationship*, not the literals 20/40 (which dogfooding will revise).
  - **HOW** — With a fixture config setting small per-entry/lifetime values (e.g. 4 and 6), via the scripted-verdict Verifier double drive a bead that hits the per-entry ceiling, exits, then re-enters from a long-cycle bounce → assert the lifetime counter continues across entries and the recovery ladder fires at the **lifetime** total, not at the per-entry ceiling; assert `lifetime > per-entry`.
  - **WHY** — RFC §6.4, §6.4.1; commitment row "Per-bead 40-iter lifetime budget". *(Parameterized off the 20/40 literals per board round 4.)*

- **P3-T26 · The long-cycle universe is direct ∪ adjacent (1-hop), snapshot-only.**
  - **WHAT** — Regression sampling covers modified claims plus 1-hop import neighbors, computed against the snapshot, excluding the bead's own delta.
  - **HOW** — Construct a bead modifying file F that imports G and is imported by H → assert the sampled universe includes claims in F, G, and H (1-hop) but not 2-hop neighbors, and that the bead's own in-flight delta is excluded from the universe.
  - **WHY** — RFC §6.5, §2.10; commitment row "Long-cycle universe = direct ∪ adjacent only".

- **P3-T27 · `/dusk-test` runs the Test Runner standalone on a scope.**
  - **WHAT** — An operator can execute the test step alone without the full pipeline.
  - **HOW** — Invoke `/dusk-test` on a scope with verified tests → assert it discovers test files via the index, invokes Vitest with the scoped list, and returns a `TestVerdict`, using an ephemeral synthetic bead-id.
  - **WHY** — RFC §10.2; roadmap Sprint 6.

- **P3-T28 · Livelock takes precedence over budget exhaustion when both fire.**
  - **WHAT** — When a bead both exhausts its budget and meets the livelock conditions, the richer livelock payload wins.
  - **HOW** — Via the scripted-verdict Verifier double (config'd so the lifetime budget exhausts on the same iteration the livelock detector fires) → assert a `TestVerifierLivelockReport` is emitted (not a generic exhaustion error) and the user resolves it before iteration would resume.
  - **WHY** — RFC §6.4.1, §3.4.1.

#### Verdict-split loop behavior

- **P3-T29 · Low-confidence support does not burn an iteration.**
  - **WHAT** — The behavior the verdict split exists to produce: `support_quality: low_confidence` (a decoration-quality signal) must **not** trigger an Engineer re-draft, while `focal_verdict: fail` must — so decoration noise doesn't consume iterations.
  - **HOW** — Drive a bead whose every focal verdict passes but whose support quality is `low_confidence` (via the scripted-verdict Verifier double returning `focal_verdict:pass` + `support_quality:low_confidence`) → assert the bead **converges and commits without re-entering Step 4**, the iteration count does not increment for the support signal, and the low-confidence support surfaces only as advisory (in the run summary / `dusk doctor`).
  - **WHY** — RFC §6.4 (loop: "`support_quality: low_confidence` does NOT trigger re-draft"), §3.3; commitment row "Verifier verdict split". *(Closes Fowler's contrarian gap: the split's load-bearing loop consequence was asserted nowhere.)*

### Phase-landing smoke test

**Scenario set — "small real change, end to end" (one primary + three bounded variants).**

- **Primary (happy path):** In a temp git repo with pre-authored intents for a two-function change (one independent impl intent + one cross-cutting intent that file-overlaps it, plus unit-test children), call `dusk_implement({request})` → the Decomposer builds a DAG with a file-overlap serialization edge, the short cycle converges (stuckness detector idle), the long cycle runs N=10 clean, the Test Runner verifies + runs the unit tests, and **one commit per bead lands on main** with full trailers; Step 9 returns the complete summary. Assert every trace shares one `index_snapshot_id` and no Verifier `raw_prompt` carried iteration-specific content.
- **Variant A (pause/resume):** the request references an unauthored intent → `implement_paused_for_authoring`; author it out-of-band; `dusk_implement({resume_token})` completes and deletes the checkpoint.
- **Variant B (recovery ladder):** force a two-intent bead to lifetime exhaustion with one intent satisfiable → Level-1 partial commit merges cleanly; a second run with zero satisfiable intents → Level-2 `bead_intent_revision_needed` with `intent-proposal.yaml`.
- **Variant C (cancel):** start the primary run, `dusk_cancel` mid-flight → `CancelResult` with correct `cancelled[]` vs `preserved[]` partitioning.

**Green means:** the full request→commit path works end-to-end with the board-hardened control machinery (snapshot coherence, stuckness/asymmetry, the complete 4-level recovery ladder, N=10+confirmation, two-stage tests+livelock, pause/resume, cancel). Phases 4 and 5 may start (Phase 4 can also have begun in parallel per the dependency map).

### Cohesive landing criteria

- [ ] All P3 behavioral tests pass — control-flow tests via the scripted-verdict Verifier double (deterministic, no model), verdict-correctness legs against the real frontier model — over real git (worktrees + rebase), real Postgres-backed fixtures where intents touch the DB layer, and real Vitest.
- [ ] The primary smoke scenario and all three variants are green.
- [ ] `dusk_implement`, `dusk_cancel`, `dusk_resolve_livelock`, `/dusk-test`, `dusk implement --resume`, and the `dusk implement` CLI mirror are operable with working `--help`; `dusk doctor --cleanup-worktrees` reaps orphans.
- [ ] No carry-over: Steps 1–9 all run for real; **all four Recovery Ladder levels fire** (L2's author-driven recovery action is wired in Phase 4, but its artifact + error contract ship here); the long cycle is N=10 with the confirmation pass; two-stage test satisfaction + livelock are live.
- [ ] The asymmetry guarantee is mechanically checked in-run: no iteration-specific content in Verifier `raw_prompt`, diagnosis present only on Bead-Orchestrator traces.

---

## Phase 4 — Intent Authoring

Roadmap Sprint 8 (parallelizable with Sprints 6–7; its only cross-link to Phase 3 is the Decomposer escalation hook stubbed in Sprint 5). This phase makes `dusk_author_*` work end-to-end as a multi-turn continuation flow and replaces the Phase-3 stub at the Decomposer pause point with the real Author flow, closing the `dusk_implement` ↔ `dusk_author` loop.

### Outcome

A user can author a complete, schema-valid intent set — including test-pyramid children and a `compose: implies` conditional intent — through a real multi-turn dialog where **every branching decision surfaces as the next question**, and the authored intents become immediately resolvable. When `dusk_implement` pauses for a missing intent, the harness can drive `dusk_author_start/_continue/_finalize` and then resume the paused pipeline to completion. Abandoned dialogs and checkpoints are garbage-collected on a 24h window.

### Scope

- **`packages/runtime/author`** — Author role (`memory: dialog`) with full role-body content, implementing the 5-stage flow (Intake & Framing → Discovery & Tension Detection via **agent-driven grep, no vector search** → Industry-Practice Injection from training + skill, **no runtime canonical-library lookup** → hierarchical Drafting with **test-pyramid proposal** → Commit), each user decision a real branching point. (Sprint 8; RFC §5, §8.10, §8.11.)
- **Stage 4.5 validations** — `dusk/author/polarity-decision` (affirmative slots + `polarity: negative`, no English negation), `dusk/author/typed-relates-to` (five-kind edges, no `refines`), `dusk/author/implies-antecedent-grammar` (closed antecedent vocabulary + resolvable references); the Sprint-1 parser rejects matrix-predicate negation / bad antecedents / unresolvable refs and bounces to the Author. (Sprint 8; RFC §3.1, §3.1.1, §3.2.1.)
- **Author skills** — `polarity-decision`, `typed-relates-to`, `implies-antecedent-grammar`, `tension-detection`, `discovery-grep-patterns`, `best-practices-application`, `test-pyramid-proposal`. (Sprint 8.)
- **Dialog directory lifecycle** — `.ia/runtime/dialogs/<dialog-id>/` created by `dusk_author_start`, destroyed by `dusk_author_finalize`, GC'd after 24h. (Sprint 8.)
- **Continuation MCP tools** — `dusk_author_start` / `dusk_author_continue` / `dusk_author_finalize` + `/dusk-author` wrapper; **`DuskError` on bad dialog ids / invalid stage responses / schema-invalid intents**. (Sprint 8; RFC §10.1, App. A.11.)
- **Decomposer integration** — replace the Sprint-5 escalation stub with the real `dusk_author_start` invocation driven through Root, **consuming the checkpoint schema frozen in Phase 3** (enriching `suggested_dialog_seed`'s content without changing its shape) and resuming after finalize. (Sprint 8; RFC §10.1.1, App. D.10.)
- **Recovery Ladder L2 recovery action** — wire the `bead_intent_revision_needed` recovery path (Phase 3 produces the `intent-proposal.yaml` + recoverable error; here `dusk_author_continue` consumes the proposal to refine the intent and re-enter Step 4). (Sprint 8; RFC §6.4.1.)
- **Doctor GC** — `dusk doctor --gc-dialogs` + `dusk doctor --gc-implement-checkpoints`. (Sprint 8; RFC §10.1.1.)

### Behavioral tests integrated in this phase

#### The 5-stage flow

- **P4-T1 · The continuation pattern runs the full 5-stage flow.**
  - **WHAT** — A fresh intent request walks all five stages via `start → continue × N → finalize`, with each stage's decision exposed as a question.
  - **HOW** — `dusk_author_start({request})` → assert stage 1 + a framing `next_question`; loop `dusk_author_continue` answering each branching decision (framing confirm, tension resolution pick, practice-proposal accept, pyramid-layer pick, accept-or-defer) → assert each response returns the next stage's `next_question` until `dusk_author_finalize` returns `intents_created[]`.
  - **WHY** — RFC §5, §10.1; commitment row "MCP resources + paired fallback tools" (continuation shape) + roadmap Sprint 8.

- **P4-T2 · Stage 2 discovery finds and classifies a real tension via grep.**
  - **WHAT** — Authoring a new intent that overlaps an existing one surfaces the overlap and asks the user to resolve it — using textual search only.
  - **HOW** — With an existing `api/pagination/cursor-only` intent present, author a new cursor-pagination intent → assert Stage 2 surfaces the existing intent classified (conflict/overlap/gray/adjacent) with resolution options, and the user-picked resolution is encoded into the drafted set; assert no embedding/vector substrate is invoked.
  - **WHY** — RFC §5 Stage 2, §8.10; commitment row "No semantic / vector / RAG layer in v1".

- **P4-T3 · Stage 4 proposes test-pyramid children for an implementation intent.**
  - **WHAT** — An impl intent yields proposed `…/unit-tests` / `…/integration-tests` / `…/e2e-tests` children, and the user picks the subset.
  - **HOW** — Author a service-layer impl intent → assert the Author proposes pyramid children with canonical `covers-X` triples; the user selects {unit, integration} → assert only those children are drafted; author a pure-leaf util → assert unit-only (no pyramid pretense beyond what's picked).
  - **WHY** — RFC §3.4, §5 Stage 4; commitment row "Test pyramid via configurable suffixes".

#### Stage 4.5 validations

- **P4-T4 · Negative meaning is authored as affirmative slots + `polarity: negative`.**
  - **WHAT** — The Author encodes "must NOT" structurally, never as English negation.
  - **HOW** — Author an intent meaning "list endpoints must not use offset pagination" → assert the committed triple has affirmative slots with `polarity: negative`; inject an attempt to write `predicate: "does not use"` → assert the parser bounces it back with a `polarity-decision` hint.
  - **WHY** — RFC §3.1, §3.1.1; commitment rows "Polarity field on triples" + "Matrix/constituent parser rule".

- **P4-T5 · `compose: implies` is authored with closed-vocabulary antecedents.**
  - **WHAT** — A conditional intent commits only when its antecedent uses the closed predicate vocabulary against resolvable references.
  - **HOW** — Author "if decorated `api/write-endpoint`, must validate idempotency" → assert it commits with a valid `antecedent`/`consequent` split; attempt a behavioral antecedent (`"performs a write"`) → assert the Author is bounced to `implies-antecedent-grammar` and the intent does not commit.
  - **WHY** — RFC §3.2.1, App. A.1; commitment row "`compose: implies` with deterministic antecedents".

- **P4-T6 · Typed `relates_to` edges are emitted (five kinds, no `refines`).**
  - **WHAT** — The Author produces typed edges and proposes reciprocal edges where applicable.
  - **HOW** — Author an intent that `implies` an existing one → assert a `{kind: implies}` edge is written and the Author proposes the reciprocal/parent edge for user confirmation; assert no `refines` kind is ever emitted.
  - **WHY** — RFC §2.1, App. D.19; commitment row "Typed `relates_to` edges (5 kinds)".

#### Commit + lifecycle + cross-tool

- **P4-T7 · Stage 5 commits atomically and makes intents immediately resolvable.**
  - **WHAT** — Finalize writes valid `intent.yaml` files atomically and the index can resolve them.
  - **HOW** — Finalize a multi-intent dialog → assert each file is written atomically, validates against the v2 schema, and a subsequent `dusk_inspect` resolves the new intents and their pyramid children; assert no code was modified during authoring.
  - **WHY** — RFC §5 Stage 5; roadmap Sprint 8.

- **P4-T8 · `dusk_implement` pauses for authoring and resumes to completion (cross-tool).**
  - **WHAT** — The real Author flow now satisfies the Decomposer's unresolved-intent escalation, closing the loop Phase 3 only stubbed.
  - **HOW** — `dusk_implement({request})` hitting an unresolved reference → `implement_paused_for_authoring{resume_token}`; drive `dusk_author_start/_continue/_finalize` to author the missing intent; `dusk_implement({resume_token})` → assert the pipeline resumes from Step 1 with the now-resolvable set and completes with a commit; assert the checkpoint file is deleted after the successful resume.
  - **WHY** — RFC §10.1.1, App. D.10; commitment row "`dusk_implement` pause/resume contract" + Sprint 8 wire-up.

- **P4-T9 · Bad dialog state returns a typed error, not a crash.**
  - **WHAT** — Continuation against an unknown/destroyed dialog is handled gracefully.
  - **HOW** — `dusk_author_continue({dialog_id:"nope"})` → assert `DuskError{kind:"author_dialog_id_unknown"}` with a recovery hint to start fresh; feed an invalid Stage response → assert `author_stage_invalid_response`.
  - **WHY** — RFC §10.1, App. A.11.

- **P4-T10 · Abandoned dialogs and checkpoints are GC'd on the 24h window.**
  - **WHAT** — Stale authoring state and paused-pipeline checkpoints don't accumulate.
  - **HOW** — Create a dialog and a checkpoint, age both past 24h, run `dusk doctor --gc-dialogs` and `--gc-implement-checkpoints` → assert both directories are reaped and a fresh (<24h) one is left untouched.
  - **WHY** — RFC §5, §10.1.1; commitment rows for pause/resume + dialog lifecycle.

#### Stage branching and dialog persistence

- **P4-T11 · Stage 1 framing loops back on user correction.**
  - **WHAT** — A user who rejects the proposed framing gets a regenerated framing, not forced progress.
  - **HOW** — In Stage 1, answer the framing question with a correction → assert `dusk_author_continue` returns a regenerated framing as the next question (still Stage 1) rather than advancing to Stage 2.
  - **WHY** — RFC §5 Stage 1.

- **P4-T12 · Stage 3 takes the greenfield path when the user rejects the practice proposal.**
  - **WHAT** — A rejected industry-practice scaffold yields a from-scratch draft, with no pretending a match exists.
  - **HOW** — In Stage 3, reject the proposed decomposition → assert the flow proceeds on a greenfield draft (no canonical-library lookup, no fabricated match) and Stage 4 drafts from the user's framing alone.
  - **WHY** — RFC §5 Stage 3, §8.11; commitment row "No runtime-fetched canonical intent library in v1".

- **P4-T13 · Dialog memory persists across turns and is destroyed on finalize.**
  - **WHAT** — Multi-turn authoring keeps state between `continue` calls and cleans it up at the end.
  - **HOW** — Across several `dusk_author_continue` calls, assert each turn sees the prior turns' decisions (the draft accumulates); after `dusk_author_finalize`, assert `.ia/runtime/dialogs/<dialog-id>/` is removed.
  - **WHY** — RFC §9.6 (`dialog` scope), §5 Stage 5, §10.1.

### Phase-landing smoke test

**Scenario — "author then resume, including a conditional intent."** Start `dusk_implement({request})` for a small feature whose target behavior is **not yet authored** → receive `implement_paused_for_authoring`. Drive the full continuation flow to author the feature's impl intent (with `polarity: negative` on one triple), its unit-test child, **and** a `compose: implies` conditional intent (closed-vocabulary antecedent) — confirming framing, resolving a discovered tension, accepting a practice proposal, and picking the unit-tests layer along the way. Finalize → intents committed atomically and resolvable. Resume `dusk_implement({resume_token})` → the pipeline completes with a commit and the checkpoint is gone. Finally, age and GC an abandoned second dialog to prove the 24h window.

**Green means:** authoring is fully operable as a multi-turn flow with all Stage-4.5 validations, and the pause/resume loop between the two MCP tools is closed end-to-end. Phase 5 may proceed (it can also have started in parallel).

### Cohesive landing criteria

- [ ] All P4 behavioral tests pass against the real model + real file system + the real `dusk_implement` pipeline (for the cross-tool resume test).
- [ ] The phase-landing smoke test passes, including authoring a `compose: implies` intent and resuming a paused run.
- [ ] `dusk_author_start/_continue/_finalize`, `/dusk-author`, `dusk doctor --gc-dialogs`, `dusk doctor --gc-implement-checkpoints` are operable with working `--help`.
- [ ] No carry-over: the Decomposer escalation point now invokes the **real** Author flow (the Sprint-5 stub is removed); Stage 4.5 validations all bounce real violations.
- [ ] Authored intents are schema-valid v2 and immediately resolvable; no code is modified during authoring.

---

## Phase 5 — Validation, Benchmarking & Dogfooding

Roadmap Sprints 9–10. This phase makes the architecture's claims **measurable** and applies the whole system to real code. It completes the observability surface, ships the three-axis fresh-Verifier audit that converts the Engineer ⊥ Verifier asymmetry from assertion into measured property, ships the static-analysis drift detector, builds the seeded-violations and worked-example fixtures, and dogfoods Dusk on a real dusk package. *(The Recovery Ladder — all four levels — ships in Phase 3 per board round 4; this phase measures the system, it no longer wires recovery.)*

### Outcome

An operator can run `/dusk-benchmark` and get per-class detection rates against a seeded-violations fixture, and `/dusk-benchmark --audit-verifier-freshness` and get **three-axis** data (verdict variance + rationale similarity + **structurally-computed citation precision**, no LLM-judge) that flags the rubber-stamp signature. `dusk doctor --static-analysis` catches decoration erosion (`S ⊄ D`) with conservative and `--strict-unknowns` modes. The worked example verifies cleanly as a standing regression fixture, and Dusk has run on a real dusk package (`packages/shared`, then `packages/api`) for ≥2 weeks with operational data collected and measured against named go/no-go thresholds.

### Scope

- **`packages/runtime/observability` (complete)** — `SubAgentTrace` emission with **all v9 fields**: `schema_version`, `index_snapshot_id`, `iteration_number`, `verdict_delta_from_prior`, `failing_triple_set`, `engineer_change_summary`, `convergence_diagnosis_present` (Bead-Orchestrator only), `stuckness_detector_state`, `verifier_livelock_signal`, `confirmation_of_trace_id`, `confirmation_pass_outcome`, `skills_loaded[]`; ring-buffered `traces.jsonl`; optional out-of-band PostHog/OTLP mirrors. (Sprint 9; RFC §7.2, App. A.6.)
- **`packages/runtime/benchmark`** — per-role per-model harness (`/dusk-benchmark` + `dusk benchmark`) and **`--audit-verifier-freshness`** implementing the three-axis audit: Axis 1 verdict variance (Shannon entropy), Axis 2 rationale similarity (token overlap), **Axis 3 citation precision** (structural `file:line` parse vs fixture `ground_truth_defect_loc`, three-tier aligned/adjacent/unaligned, **no LLM-judge**). **Thresholds are pre-registered (NEW per board round 4):** the pass bars are calibrated on a held-out controversial/known-good split and *frozen* before the known-bad set is scored — calibration data is never the test data. **All three axes get explicit numeric bars** (Axis 1/2 are no longer "vibes"), and the **standing audit runs N≥10** (N=5 is reserved for the cost-bounded confirmation pass, which feeds the audit as a distinct cohort). The **organic confirmation-pass cohort** is aggregated via `confirmation_of_trace_id` and tagged with its selection bias. (Sprint 9; RFC §7.5, §7.5.1.)
- *(Recovery Ladder Levels 1–4 ship in Phase 3, not here — see Phase 3 scope `packages/runtime/recovery-ladder`. This phase only consumes their artifacts in the dogfood traces.)*
- **`packages/cli` — `dusk doctor` (complete)** — base validation; **`--static-analysis`** (`S ⊆ D` call-graph + decorator lookup; **conservative default** uninstrumented-callee policy + **`--strict-unknowns`** `undecorated_callee` finding class; framed as drift detection); `--check-hook [--repair]`, `--cleanup-worktrees`, `--gc-dialogs`, `--gc-implement-checkpoints`; structured severity report. (Sprint 9; RFC §4.6, §8.9.)
- **`packages/fixtures/seeded-violations/`** — ~60 violations across four classes (mechanical/gate, static-analysis/doctor, verification/LLM incl. quantifier + `implies`-consequent + negative-polarity cases, two-stage-test); each fixture YAML carries `ground_truth_outcome` + **`ground_truth_defect_loc: {file, line}`**. (Sprint 9.)
- **`packages/fixtures/worked-example/`** — App. B `sendNotification` decorated; standing `dusk verify` regression fixture. (Sprint 9.)
- **Dogfooding (Sprint 10)** — author + decorate `packages/shared` (pure leaf), run `dusk_implement` for small requests, run `/dusk-doctor` periodically, ≥2 weeks; collect operational + adoption-friction data; expand toward `packages/api`. Light-touch ecosystem skeletons (registry routes in `packages/api`, adherence/tree/coverage views in `packages/web`). (Sprint 10.)

### Behavioral tests integrated in this phase

#### Observability

- **P5-T1 · Every sub-agent call emits one fully-populated trace.**
  - **WHAT** — The trace stream is complete enough to debug a stuck bead and feed the audit.
  - **HOW** — Run a pipeline that exercises stuckness, a long-cycle confirmation, and a livelock, then read `traces.jsonl` → assert one event per sub-agent call and that the relevant events carry `index_snapshot_id`, `iteration_number`, `verdict_delta_from_prior`, `failing_triple_set`, `engineer_change_summary`, `stuckness_detector_state`, `verifier_livelock_signal`, `confirmation_of_trace_id`, `confirmation_pass_outcome`, and `skills_loaded[]`.
  - **WHY** — RFC §7.2, App. A.6; commitment rows across §6.4.2/§6.5/§3.4.1.

#### Fresh-Verifier audit (three axes, no LLM-judge)

- **P5-T2 · Citation precision is computed by structural parse against ground truth. (unit-only)**
  - **WHAT** — The third audit axis scores `aligned`/`adjacent`/`unaligned` deterministically with no model in the loop.
  - **HOW** — Feed verdict rationales with known `file:line` citations and a fixture `ground_truth_defect_loc` → assert ±2-lines-same-file → `aligned`, same-file-far or 1-hop import → `adjacent`, wrong/absent → `unaligned`; assert the scorer makes **zero** model calls.
  - **WHY** — RFC §7.5.1; commitment row "Three-axis fresh-Verifier audit … citation precision (structural parse, no LLM-judge)". *Unit-only justification:* deterministic regex+comparison transform; P5-T3 exercises it end-to-end.

- **P5-T3 · The audit produces interpretable three-axis data and flags rubber-stamping, against pre-registered bars.**
  - **WHAT** — On the curated fixture set, the audit yields variance + similarity + precision, scores them against frozen thresholds, and surfaces the High-similarity × Low-precision quadrant.
  - **HOW** — Calibrate the pass bars on a held-out controversial/known-good split and **freeze** them; then run `--audit-verifier-freshness` (N≥10) over the known-bad set → assert it meets the *pre-registered* citation-precision bar (≥80% ≥4/5 `aligned`; ≤5% 5/5 `unaligned`) **and** explicit numeric bars on Axis 1 (variance) and Axis 2 (similarity); assert a deliberately rubber-stamping prompt variant lands in the High-similarity × Low-precision quadrant per the §7.5.1 table; assert that a Verifier producing **no** `file:line` citation is flagged (Axis 3 → all-`unaligned`) rather than silently degrading the audit.
  - **WHY** — RFC §7.5, §7.5.1; commitment rows "Engineer ⊥ Verifier asymmetry" + "Three-axis fresh-Verifier audit". *(Pre-registration + Axis-1/2 numeric bars + N≥10 + no-citation handling added per board round 4.)*

- **P5-T4 · Organic confirmation-pass data feeds the audit as a separate, bias-annotated cohort.**
  - **WHAT** — Production confirmation calls extend the audit without being conflated with the curated baseline or read as unbiased.
  - **HOW** — After a pipeline run that produced confirmation calls (`confirmation_of_trace_id` set), run the audit → assert those calls aggregate into a distinct "organic" cohort **and** that cohort's report carries an explicit selection-bias annotation (`selection: first-call-rejected`, `precision_not_comparable_to_curated`) so the no-blended-metrics rule is enforced mechanically.
  - **WHY** — RFC §7.5.1; commitment row "Long-cycle N=10 + N=2 confirmation pass" (audit linkage). *(Bias annotation added per board round 4.)*

#### Static analysis (decoration-erosion drift)

- **P5-T5 · `--static-analysis` catches `S ⊄ D` with the conservative default.**
  - **WHAT** — Decoration erosion (a sub-operation touching an intent not on its enclosing unit) is detected off the write path, without false-positive floods from uninstrumented callees.
  - **HOW** — Run `dusk doctor --static-analysis` over the seeded static-analysis fixtures → assert every seeded `S ⊄ D` violation is reported with `file:line` + a suggested decomposition, and uninstrumented callees contribute **empty** intent sets (no spurious findings).
  - **WHY** — RFC §4.6, §8.9; commitment row "`dusk doctor --static-analysis` … conservative + `--strict-unknowns` modes".

- **P5-T6 · `--strict-unknowns` surfaces undecorated callees as their own class.**
  - **WHAT** — Projects ready to enforce coverage can see uninstrumented callees explicitly.
  - **HOW** — Re-run with `--strict-unknowns` over a fixture with uninstrumented callees → assert they appear as `undecorated_callee` findings, distinct from `S ⊄ D` findings.
  - **WHY** — RFC §8.9; commitment row "`dusk doctor --static-analysis` … `--strict-unknowns`".

#### Typed-edge doctor surface + real-model variance characterization

*(The Recovery Ladder Levels 2 + 3 moved to Phase 3 — see P3-T12 / P3-T12b. The slots here now cover two gaps the board flagged.)*

- **P5-T7 · `dusk doctor` flags code carrying both sides of a `conflicts` pair.**
  - **WHAT** — The second half of the `conflicts` edge semantics (beyond the Decomposer's hard refusal) is enforced off the write path.
  - **HOW** — With intents A and B linked `conflicts`, decorate one file carrying both `@intent A` and `@intent B` → assert `dusk doctor` reports the conflicting co-decoration with `file:line`.
  - **WHY** — RFC §2.1 (`conflicts` row: "`/dusk-doctor` flags any code carrying both decorations"). Closes a typed-edge secondary-behavior gap.

- **P5-T8 · The real-model confirmation-pass flake rate is characterized, non-gating.**
  - **WHAT** — The *assumption* behind the N=2 confirmation pass — that real-Verifier rejects on clean code are rare and confirmations usually override them — is measured against the real frontier model, but never as a pass/fail gate (the mechanism is gated by P3-T14/T15 with the Verifier double).
  - **HOW** — Run a high-N statistical characterization of first-call-reject → confirmation-outcome on clean fixtures against the real model → **report** the observed flake/dismissal rate with tolerance bands; assert only that the harness produces the report, not a specific rate.
  - **WHY** — RFC §6.5, §7.5.1; companion to P3-T15 (separates mechanism from variance per board round 4).

#### Seeded fixture + worked example

- **P5-T9 · Detection rates hold per violation class.**
  - **WHAT** — Each defect class is caught by the layer that's supposed to catch it.
  - **HOW** — Run the benchmark over the ~60-violation fixture → assert the mechanical class is **100%** gate-caught; the static-analysis class is doctor-caught (not gate-caught); the verification class (incl. quantifier-cardinality, `implies`-consequent on antecedent-true, and negative-polarity-should-reject cases) is Verifier-caught; the two-stage-test class is caught by the Verifier's test-body evaluation (not by the Test Runner).
  - **WHY** — RFC §3.1, §3.2.1, §3.4, §4.6, §8.9; roadmap Sprint 9 fixture spec.

- **P5-T10 · The worked example verifies cleanly as a standing regression.**
  - **WHAT** — The canonical App. B decoration never silently rots.
  - **HOW** — Run `dusk verify` over `packages/fixtures/worked-example/` → assert all focal verdicts pass; assert this runs in the CI test surface so every PR re-validates it.
  - **WHY** — RFC App. B; roadmap Sprint 9.

#### Dogfooding

- **P5-T11 · Dusk authors, decorates, and implements against a real package — measured against go/no-go thresholds.**
  - **WHAT** — The whole system operates on real dusk code, not just fixtures, and the dogfood gate has *teeth* — it is not "data was collected."
  - **HOW** — Against `packages/shared`: author intents via `dusk_author`, decorate existing code under the gate, run `dusk_implement` for a small real feature request → assert (hard) a real commit lands with full trailers and the package's existing tests still pass; collect the operational metrics the roadmap enumerates and **assert named go/no-go thresholds** (e.g. ≥1 successful end-to-end `dusk_implement` producing a mergeable commit; gate false-positive rate = 0 on the decorated package; worked-example regression stays clean). Metrics with no pre-set bar (iteration distribution, Author branching distribution) are explicitly recorded as **exploratory, not gating** — the plan is honest about which numbers block v1 and which merely inform v1.x.
  - **WHY** — Roadmap Sprint 10; RFC §8.2 (decorate-at-authorship validated on a real leaf package). *(Go/no-go teeth added per board round 4 — "≥2 weeks of data collected" alone was not a real gate.)*

#### Sinks, benchmark breadth, ecosystem skeletons

- **P5-T12 · Optional out-of-band sinks mirror traces without blocking the pipeline.**
  - **WHAT** — Enabling a PostHog/OTLP mirror never gates or stalls a run if the sink is unavailable.
  - **HOW** — Enable an OTLP mirror pointed at an unreachable endpoint, run a pipeline → assert `traces.jsonl` is written completely and the pipeline finishes normally; the unreachable sink (the one **unmanaged** dependency, mocked here) produces no pipeline error.
  - **WHY** — RFC §7.2, §10.3 ("optional sinks are out-of-band file mirrors").

- **P5-T13 · The benchmark produces per-model accuracy + a cross-model agreement matrix.**
  - **WHAT** — `/dusk-benchmark` answers the head-to-head questions the RFC names.
  - **HOW** — Run `dusk benchmark --models …` over the seeded fixture → assert the report carries per-model per-class accuracy, per-role-per-model latency/cost, and a cross-model Verifier-verdict agreement matrix.
  - **WHY** — RFC §7.3, §7.4.

- **P5-T14 · Ecosystem skeletons are routable / renderable.**
  - **WHAT** — The light-touch ecosystem surfaces exist and respond, even if not feature-complete.
  - **HOW** — Hit the registry canonical-intent search/download routes in `packages/api` → assert a structured response; render the `packages/web` adherence + intent-tree + decoration-coverage views → assert they load against a decorated package's index.
  - **WHY** — Roadmap Sprint 10 (ecosystem skeletons — "routable / renderable but not feature-complete").

### Phase-landing smoke test

**Scenario set — "measure everything, then run for real."**

- **Measurement:** Run `/dusk-benchmark` over the seeded-violations fixture → per-class detection rates at the expected thresholds (mechanical 100%; others reported). Run `/dusk-benchmark --audit-verifier-freshness` → three-axis data scored against the pre-registered bars, with the rubber-stamp quadrant correctly flagged on the planted bad-prompt variant. Run `dusk doctor --static-analysis` over a real package → a baseline decoration-density + `S ⊄ D` report in conservative mode, and `undecorated_callee` findings under `--strict-unknowns`. `dusk verify` the worked-example fixture → clean.
- **Real run:** One real `dusk_implement` request against the decorated `packages/shared` produces a committed change with full trailers; `packages/shared`'s own test suite stays green; one full trace stream is captured with all v9 fields populated; the named go/no-go thresholds (P5-T11) pass.

**Green means:** the architecture's claims are measured (detection rates, three-axis asymmetry audit, decoration-erosion drift), and Dusk has run end-to-end on real dusk code against go/no-go thresholds. v1 is landed. *(The complete recovery ladder was already proven in Phase 3.)*

### Cohesive landing criteria

- [ ] All P5 behavioral tests pass against real dependencies (real frontier model for the audit, real call-graph build for static analysis, real git, real Vitest for the dogfood package); the citation-precision scorer and seeded fixtures use no model.
- [ ] The measurement + real-run smoke scenarios are green and the go/no-go thresholds pass.
- [ ] `/dusk-benchmark` (+ `--audit-verifier-freshness`), `dusk doctor --static-analysis` (+ `--strict-unknowns`), and the remaining `dusk doctor` subcommands are operable with working `--help`.
- [ ] No carry-over: the trace stream carries **all** v9 fields; the audit uses **no** LLM-judge and scores against **pre-registered** bars; the seeded fixture carries `ground_truth_defect_loc` on every seeded-bad case. (The recovery ladder shipped and was gated in Phase 3.)
- [ ] Dusk has operated on ≥1 real dusk package (`packages/shared`, expanding toward `packages/api`) for ≥2 weeks; operational + adoption-friction data is collected and fed back into role prompts/skills; ecosystem skeletons are routable/renderable.

---

## Phase 6 — Greenfield POC (POST-V1 — the first v1.x change)

**This phase is not part of the v1 gate.** It begins only after Phase 5 archives and v1 is landed (Roadmap Sprint 11). It adds no rows to the coverage matrix below.

**Why greenfield, and why first.** v9 is designed greenfield-first: decoration happens at authorship (RFC §8.2 defers legacy bootstrap precisely because retro-decorating >20kLOC is the *un*-native mode), code is authored for AI consumption, and the whole apparatus — total decoration, the gate, per-aspect verification — is cheapest and highest-fidelity when every line is born decorated. Yet v1 never tests that native mode in its pure form. The v1 dogfood (P5-T11) is brownfield-lite: it decorates *existing* code on a *pure-leaf* package whose test pyramid is unit-only. Three gaps remain after v1 lands: (a) **the thesis itself** — "humans express intents; the harness produces adherent code" — has never run with zero hand-written application code; (b) **the full test pyramid has never executed against real infrastructure on real (non-fixture) code** — `packages/shared` has no DB and no HTTP, so the integration-tests/e2e-tests layers were only ever proven on Phase-3 fixtures; (c) **greenfield intent-tree authoring at application scale** — Stage-2 tension detection as a tree grows from nothing — has only been exercised one intent at a time. Phase 6 closes all three with one artifact: a small, working API application that exists only because Dusk built it.

### Outcome

A fresh repository contains a small but real API application — cursor-paginated reads, an idempotent write endpoint, Drizzle + Postgres persistence, structured logging, a full unit/integration/e2e test pyramid running against live infrastructure — in which **every line of application code was produced through `dusk_author` + `dusk_implement`**, mechanically auditable via the commit trailer record. Human contributions are confined to an enumerated whitelist: authoring-dialog responses, `dusk_implement` requests, livelock/recovery resolutions, and commit review. The POC's friction data (greenfield-specific: dialog ergonomics, Stage-3 proposal quality, intent-granularity choices, time-to-endpoint) seeds the v1.x backlog.

### Scope

- **The POC target** — a fresh standalone git repository (NOT a dusk-monorepo package: the POC's git history must be purely Dusk-authored and independently auditable), initialized from zero via `dusk init`. The application: a minimal **notifications API** on Dusk's own stack conventions (TypeScript strict ESM, Express + tRPC, Drizzle + Postgres, Vitest) — deliberately the same domain as the canonical intents and the App. B worked example, so the Author's Stage-2/Stage-3 machinery operates on familiar ground: 4–6 endpoints across ~2 resources, including a cursor-paginated list endpoint (under the pagination intents), an idempotent write endpoint (under a `compose: implies` idempotency-on-writes intent), structured-logging + error-handling cross-cutting intents, and a full test pyramid with integration-tests (real Postgres) and e2e-tests (the app's real HTTP surface) children. (Sprint 11; RFC §5, §3.2.1, §3.4, §8.2.)
- **The thesis constraint: zero hand-written application code.** All application source is produced by the pipeline. Human inputs are whitelisted: dialog responses (`dusk_author_continue`), `dusk_implement` requests, `dusk_resolve_livelock` / recovery-ladder resolutions, and commit review/merge approval. The constraint is **mechanically audited**: a trailer-audit script walks the POC's git history and verifies every commit touching application source carries the full v9 trailer set (`Bead-id`/`Verdict-id`/`Trace-id`/…) or is a merge of such commits. (Sprint 11; RFC §6.7, App. A.7.)
- **Greenfield intent-tree authoring** — the entire tree (~10–20 intents) through full-mode `dusk_author_*` dialogs, including ≥1 `polarity: negative` triple, ≥1 `compose: implies` intent with a closed-vocabulary antecedent, and test-pyramid children at the unit + integration + e2e layers. Stage-2 tension detection is exercised *as the tree grows* — later intents must discover and classify earlier ones. (Sprint 11; RFC §5, §3.1, §3.2.1.)
- **The full pyramid on real infrastructure** — the Test Runner executes Verifier-validated integration tests against live Postgres and e2e tests against the app's real HTTP surface, through the pipeline (two-stage satisfaction + livelock machinery live). This is the first real-code, real-infra pyramid run. (Sprint 11; RFC §3.4, §6.6.)
- **Pipeline breadth on greenfield code** — ≥1 `dusk_implement` request that decomposes to a multi-bead DAG with a file-overlap serialization edge (a cross-cutting intent overlapping an endpoint module); ≥1 naturally-occurring pause → author → resume loop (a request referencing a not-yet-authored intent mid-build). Recovery/livelock paths are recorded if they occur naturally — not artificially forced. (Sprint 11; RFC §6.2, §10.1.1.)
- **Measurement carry-over** — the Phase-5 instruments run against the POC: complete trace streams; periodic `dusk doctor` + `--static-analysis` (born-decorated code should show **zero erosion** — the strongest available validation of the decorate-at-authorship design); a POC adherence baseline via `dusk_inspect`/the registry surfaces. (Sprint 11; RFC §8.9.)
- **Friction → v1.x backlog** — the dogfood mechanics reused: dated JSONL under the POC's `.ia/observability/`, a `PocReport` (the `DogfoodReport` shape reused with a POC profile) separating hard gates from exploratory data; friction-driven role/skill edits land in the dusk repo as ordinary reviewed commits. (Sprint 11.)

### Behavioral tests integrated in this phase

#### The thesis constraint

- **P6-T1 · Zero hand-written application code — mechanically audited.**
  - **WHAT** — The defining constraint holds and is provable from the git record alone.
  - **HOW** — Run the trailer-audit script over the POC repo's full history → assert every commit touching application source carries the full v9 trailer set (or is a merge of such commits); assert the whitelist (dialog responses, requests, resolutions, review) covers every human action recorded. The auditor is a zero-model pure pass over `git log`.
  - **WHY** — The v9 thesis (RFC §1); the constraint that distinguishes Phase 6 from the brownfield dogfood.

- **P6-T2 · The intent tree is born entirely through dialogs.**
  - **WHAT** — Every intent in the POC traces to an authoring dialog; the hard constructs are present.
  - **HOW** — For every intent under the POC's `.ia/intents/`, assert a corresponding `DialogState` transcript exists (or a finalize record naming it); assert the tree contains ≥1 `polarity: negative` triple, ≥1 `compose: implies` intent with a closed-vocabulary antecedent, and pyramid children at unit + integration + e2e layers — each matching its dialog's Stage-4/4.5 outcome.
  - **WHY** — RFC §5; greenfield authoring at tree scale, which P4-T1 only exercised one intent at a time.

#### The pyramid on real infrastructure

- **P6-T3 · Integration tests execute against live Postgres through the pipeline.**
  - **WHAT** — The integration-tests layer runs for real on real code — the first time outside fixtures.
  - **HOW** — A `dusk_implement` run whose intent set includes an `…/integration-tests` child produces Verifier-validated tests that the Test Runner executes against the POC's live Postgres → assert the `TestVerdict` satisfies the layer's `covers-*` triples and the commit carries `Test-Intent` + `Test-Verdict-id` trailers.
  - **WHY** — RFC §3.4, §6.6; closes v1 gap (b) — `packages/shared` is unit-only.

- **P6-T4 · E2e tests execute against the app's real HTTP surface through the pipeline.**
  - **WHAT** — The e2e layer runs against the running application.
  - **HOW** — Same shape as P6-T3 for an `…/e2e-tests` child: the Test Runner boots/targets the app's HTTP surface, executes the e2e suite → assert the `TestVerdict` and trailers.
  - **WHY** — RFC §3.4, §6.6; the layer v1 never ran on real code.

#### Pipeline breadth on greenfield code

- **P6-T5 · A multi-bead, file-overlap-serialized request lands on real code.**
  - **WHAT** — The Decomposer's overlap machinery operates on a real module graph, not a fixture.
  - **HOW** — Issue a request decomposing to ≥2 beads where a cross-cutting intent (e.g., structured-logging) overlaps an endpoint module → assert the DAG contains the serialization edge, the beads run in the documented order, and one commit per bead lands with full trailers.
  - **WHY** — RFC §6.2; P3-T3 proved this on fixtures only.

- **P6-T6 · The pause → author → resume loop closes naturally mid-build.**
  - **WHAT** — The Phase-4 loop operates in real greenfield flow, where missing intents are the *normal* case.
  - **HOW** — Issue a request referencing a not-yet-authored behavior → `implement_paused_for_authoring` with the enriched seed; drive the real dialog; `dusk_implement({resume_token})` completes with a commit; checkpoint deleted.
  - **WHY** — RFC §10.1.1; P4-T8 on real work instead of a fixture.

#### The deliverable + the design validation

- **P6-T7 · The application works.**
  - **WHAT** — The deliverable is a working API, not a trace stream.
  - **HOW** — Boot the POC app → assert the endpoints respond; assert cursor-pagination semantics (opaque cursor, stable ordering) and idempotency semantics (duplicate write with same key → single effect) via the app's own e2e suite; assert the full suite (all pyramid layers) is green.
  - **WHY** — Sprint 11's product bar; an adherent-but-broken app would falsify the thesis just as surely as hand-written code.

- **P6-T8 · Born-decorated code shows zero erosion.**
  - **WHAT** — Decorate-at-authorship produces and *maintains* total decoration — the design claim brownfield can't validate.
  - **HOW** — Run `dusk doctor --static-analysis` (conservative) over the finished POC → assert zero unresolved `S ⊄ D` findings (any finding is either pipeline-fixed or carries a documented disposition); run `--strict-unknowns` → assert zero `undecorated_callee` findings in application code.
  - **WHY** — RFC §4.1, §8.9; the strongest available evidence for the greenfield-first posture.

### Phase-landing smoke test

**Scenario — "from `git init` to a working API, hands off the code."** In a fresh repository: `dusk init` → author the intent tree through real dialogs (including the polarity-negative, `implies`, and pyramid constructs) → a series of `dusk_implement` requests builds the application (at least one multi-bead/file-overlap run and one natural pause→author→resume among them) → the app boots and its full pyramid (unit + integration vs live Postgres + e2e vs real HTTP) is green → the trailer audit confirms zero hand-written application code → `dusk doctor --static-analysis` is clean in both modes → the `PocReport` gates pass.

**Green means:** the v9 thesis holds in its pure form on Dusk's native (greenfield) terrain, the full pyramid runs on real infrastructure, and the POC stands as the canonical greenfield reference for v1.x adopters.

### Cohesive landing criteria

- [ ] All P6 behavioral tests pass — the trailer auditor, transcript checker, and `PocReport` evaluator are zero-model pure passes; the build itself runs the production pipeline (real frontier model, ambient CLI, transport amendment applied).
- [ ] The phase-landing smoke scenario is green end-to-end.
- [ ] Hard gates: zero hand-written application code (P6-T1); all endpoints landed via `dusk_implement` with mergeable commits; the POC's own full pyramid green against live infrastructure; gate false-positive rate = 0 on the POC; intent tree 100% dialog-authored (P6-T2); static analysis clean in both modes (P6-T8).
- [ ] Exploratory (explicitly non-gating, recorded in the `PocReport`): dialog turn counts, Stage-3 proposal acceptance rate, iteration distributions, pause/resume frequency, intent-granularity stats, time-to-endpoint.
- [ ] Friction data fed back into role prompts/skills in the dusk repo as reviewed commits; the POC repo is publishable as the canonical greenfield reference.

---

## Commitment → Phase coverage matrix

Every v1 commitment from the roadmap's "Architectural commitments locked for v1" table and the plan brief's "Hard expectations" list, mapped to the phase that lands it and a representative behavioral test. If a row has no phase, v1 is not done. **(Phase 6 is post-v1 and adds no rows to this ledger — v1 completeness is determined by Phases 1–5 alone.)**

| Commitment | RFC § | Phase | Representative test(s) |
|---|---|---|---|
| Polarity model + runtime inversion | §3.1, §3.3, D.17 | 1 (parser), 2 (inversion) | P1-T3, P2-T5 |
| Matrix/constituent parser rule + expanded lexicon | §3.1.1, D.20 | 1 | P1-T3, P1-T11 |
| `compose: implies` + deterministic closed-vocab antecedents (all 3 predicates + set-complement + no-LLM-fallback) | §3.2.1, D.18 | 1 (grammar), 2 (eval) | P1-T4, P2-T6, P2-T6b, P2-T6c, P2-T7, P2-T7b |
| Quantifier vocabulary (incl. `≤`/`none` family) + optional `scope` binding | §3.1 | 1 (schema), 2 (cardinality) | P1-T2, P2-T15, P2-T15b, P2-T15c |
| Five-kind typed `relates_to` (incl. secondary gate/doctor/scope behaviors) | §2.1, D.19 | 1 (resolve+gate), 3 (decompose), 4 (author), 5 (doctor) | P1-T1, P1-T21, P3-T2, P4-T6, P5-T7 |
| Session-snapshot index + per-bead delta + `index_snapshot_id` | §2.10 | 3 | P3-T1, P5-T1 |
| Stuckness detector + iter-5 fallback + iter-15 escalation | §6.4, §6.4.2 | 3 | P3-T8, P3-T9, P3-T10 |
| Lifetime budget + **complete 4-level recovery ladder (all in Phase 3)** | §6.4.1 | 3 | P3-T11, P3-T12, P3-T12b, P3-T12c |
| Single **frontier-tier** model in v1 (per-role override; tier-down = Sprint-9 optimization) + `temperature: 0` verdict calls | §7.1 | (cross-cutting) | Conventions; P5-T13 |
| Long cycle N=10 + N=2 confirmation pass (mechanism vs variance split) | §6.5, D.3 | 3 (mechanism), 5 (variance) | P3-T13, P3-T14, P3-T15, P5-T8 |
| File-overlap + cross-bead focal/support overlap (focal=hard, support=warn) | §6.2, §8.9 | 3 | P3-T3, P3-T4 |
| Two-stage test satisfaction + livelock + `dusk_resolve_livelock` (3 verbs) | §3.4, §3.4.1 | 3 | P3-T16, P3-T18 |
| Verdict split (focal drives, support advisory) + per-claim triple_verdict + **loop non-redraft** | §3.3, §6.4, A.4 | 2 (shape), 3 (loop) | P2-T8, P2-T9, P3-T29 |
| Three-axis fresh-Verifier audit incl. citation precision (no LLM-judge, pre-registered bars) | §7.5, §7.5.1 | 5 | P5-T2, P5-T3, P5-T4 |
| `dusk_implement` pause/resume via disk checkpoint + `resume_token` (24h, crash-safe) | §10.1.1 | 3 (mechanism), 4 (real author) | P3-T5, P3-T6, P3-T7, P4-T8 |
| `dusk_author_*` continuation + Stage 4.5 validations | §5, §3.1.1, §3.2.1 | 4 | P4-T1, P4-T4, P4-T5 |
| `dusk_cancel` cooperative semantics + `CancelResult` | §10.1.2 | 3 | P3-T22 |
| MCP resources + paired read-only fallback tools | §10.1 | 2 | P2-T13 |
| `dusk init` `_dusk_marker` idempotent merge + conflict three-option | §4.6.1 | 1 | P1-T13, P1-T14 |
| `DuskError` envelope on every MCP tool | A.11 | 2 (read tools), 3–4 (pipeline/author) | P2-T14, P4-T9 |
| 10-check PreToolUse gate (incl. check 10) | §4.6 | 1 | P1-T9, P1-T10, P1-T11 |
| `dusk doctor --static-analysis` conservative + `--strict-unknowns` | §4.6, §8.9 | 5 | P5-T5, P5-T6 |
| Dual-channel bead memory + mechanical-only compaction | §9.6.1 | 2 | P2-T2 |
| Engineer ⊥ Verifier asymmetry protection (diagnosis → Bead Orchestrator only; no iteration-specific content in Verifier `raw_prompt`) | §9.2, §6.4, §7.5 | 2 (non-leak), 3 (in-run), 5 (audit) | P2-T1, P2-T3, P3-T8, P5-T3 |
| Test-mode `raw_prompt` capture + scripted-verdict Verifier double + injectable clock | §9.9, A.6 | 1 (doubles/clock), 2 (raw_prompt) | P2-T3, P2-T5, P3-T8, P3-T15 |
| 10-check gate → **12 typed rejection kinds** (full surface) | §4.6, A.8 | 1 | P1-T10 |
| Configurable test-pyramid suffixes via `dusk.config.yml` | §3.4 | 1 (parse/index), 4 (propose) | P1-T5, P4-T3 |
| Seeded-violations fixture w/ `ground_truth_defect_loc` per fixture | Sprint 9 | 5 | P5-T9, P5-T2 |
| Verifier prompt template: two-path (standard + implies) + App. B few-shots | §3.3, §9.5, App. B | 2 | P2-T5, P2-T6, P2-T12 |
| Sub-agent spawn via Task tool + memory/skills materialized by Dusk | §9.9 | 2 | P2-T1, P2-T4 |
| Tool/skill scoping advisory in v1 (gate is the real boundary) | §9.4, §9.7 | 1 (gate), 2 (advisory + audit) | P1-T10, P2-T4 |
| Atomic commit trailers incl. `Partial`/`Deferred-Intent`/`Test-Verdict-id`/`Verifier-bypassed-test-intent` | §6.7, A.7 | 3 | P3-T19, P3-T11, P3-T18 |
| Worktrees (`dusk/<bead-id>`) + topological merge + decorator-aware Conflict Resolver | §6.3, §6.8 | 3 | P3-T20 |
| Full v9 trace fields (`confirmation_*`, `stuckness_*`, `verifier_livelock_signal`, `skills_loaded`, …) | A.6 | 5 | P5-T1 |
| Dogfood on a real package (`packages/shared` → `packages/api`) | Sprint 10 | 5 | P5-T11 |

**Deferred to v1.x (out of scope here, per the roadmap's explicit deferral list):** semantic/vector search for Author Stage 2; runtime-fetched canonical intent library; noun-phrase-shared long-cycle expansion; heterogeneous per-role models; per-intent claim minimum; tool-scope and skill-scope **hard** sandboxing; CLAUDE.md binding **hard** enforcement; legacy bootstrap; exhaustive verification mode; multi-language decoration; multi-framework coexistence; Orchestrator state-machine split; polyglot test runners; curated-vocabulary SSoT. These are the *only* permitted omissions.

---

## Reviewer feedback applied (architecture board — round 4)

This plan was reviewed by a five-member architecture board (Lead Architect, Principal Engineer, Lead AI/LLM Engineer, Lead Constraint-Language Engineer, Martin Fowler). All five returned **Approve-with-changes**. The changes below are folded into the plan above. Scaling guidance for v1: Dusk v1 is **not built to scale** — it leans on frontier-model determinism and optimizes the test/model substrate once efficacy testing begins; the board's "scale-ready CI tiering" recommendation is therefore applied only as a pragmatic posture (determinism mechanisms kept; heavy CI infra not).

| # | Board finding (reviewer) | Resolution in this plan |
|---|---|---|
| 1 | Freshness tests asserted "byte-identical payload" against `input_summary` (a lossy summary), not the real prompt — too strong and too weak (Fowler + AI/LLM) | **Test-mode `raw_prompt` capture** added to the spawn pipeline (Phase 2 scope; RFC App. A.6). Freshness reframed off byte-identity to **structural no-leak in `raw_prompt`** + the §7.5 audit (P2-T1, P2-T3, P3-T8, P2-T17). |
| 2 | Recovery Ladder split (Phase 3 L1+L4 / Phase 5 L2+L3) shipped a Phase-3 proposal whose error contract contradicted RFC §6.4.1 (Architect + PE) | **Entire 4-level ladder moved into Phase 3.** P3-T12 corrected to Level 2 (`bead_intent_revision_needed`, recoverable); P3-T12b (L3 freeze), P3-T12c (L4 abort = freeze-unwritable) added. Phase 5's L2/L3 scope + tests removed. |
| 3 | No model-nondeterminism policy; CI not runnable as written (PE + AI/LLM) | **Model & determinism posture** added to Conventions: frontier-tier default, `temperature: 0` verdict calls, **scripted-verdict Verifier double** + **injectable clock** as Phase-1 shared infra; **pragmatic, not scale-ready CI** per the v1 scaling guidance. |
| 4 | Confirmation-pass flake tests unbuildable against a real model (PE + AI/LLM) | **P3-T14/T15 reframed** onto the scripted Verifier double (deterministic mechanism); the real-model flake *rate* characterized non-gating in **P5-T8**. Budget/stuckness/livelock tests likewise driven by the double. |
| 5 | `compose: implies` antecedents: only 1 of 3 predicates, no set-complement, no no-LLM-fallback test (Constraint Lang — its single most important) | Added **P2-T6b** (all 3 antecedent predicates), **P2-T6c** (negative-polarity set-complement), **P2-T7b** (ambiguous → `verifier_evidence_too_large`, zero LLM calls). P2-T6 primary assertion changed to "no Verifier call for the consequent." |
| 6 | Quantifier vocabulary half-tested; `scope` binding untested (Constraint Lang) | Added **P2-T15b** (`none`/`at-most-one`/`at-most-N`) and **P2-T15c** (same code, different `scope`, different verdict). |
| 7 | Gate test conflated 10 checks with 12 rejection kinds; ≥2 kinds untested (Constraint Lang) | **P1-T10 re-pivoted to one fixture per App. A.8 rejection kind** (12). RFC §4.6 / App. A.8 updated to state the 10→12 mapping. |
| 8 | Cross-phase seams unpinned: checkpoint schema, `index_snapshot_id` origin (Architect) | Checkpoint JSON shape **frozen in Phase 3 scope** as the cross-proposal interface; `index_snapshot_id` marked **optional/unset in Phase 2**. |
| 9 | The verdict split's load-bearing loop consequence (low-confidence ≠ re-draft) was tested nowhere (Fowler's contrarian) | Added **P3-T29** (low-confidence support → bead commits without an extra iteration) + P2-T8 now asserts the signal surfaces in `dusk_inspect`. |
| polish | byte-equivalence (P2-T13), 4KB/5-section memory asserts (P2-T2), 20/40 literals (P3-T25), `supersedes`/`conflicts`/`sibling` secondary behaviors, dogfood gate teeth (P5-T11), audit pre-registration + Axis-1/2 bars + N≥10 (P5-T3/T4) | All applied as described inline; representative new tests P1-T21 (supersedes gate-warn), P5-T7 (conflicts doctor-flag), P3-T2 (sibling no-expand). |

Two RFC documentation defects were corrected in passing (companion edits to `intent-architecture-proposal.md`): the stale App. C row claiming the diagnosis "flows into Verifier spawn payloads on iter ≥ 6" (contradicting the hardened Bead-Orchestrator-only routing), and the 10-checks-vs-12-rejection-kinds reconciliation. The roadmap (`intent-architecture-roadmap.md`) was updated cohesively: model posture (frontier-tier + `temperature: 0`), Recovery Ladder fully in Sprint 5, the determinism/test-double posture, and a round-4 entry.

---

Build for right. Land the plane.
