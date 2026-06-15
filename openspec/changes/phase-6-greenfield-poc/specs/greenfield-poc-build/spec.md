## ADDED Requirements

### Requirement: Dusk operates against an external standalone POC repository through the gated CLI implement path

The POC SHALL be a fresh standalone git repository (`git init` from zero, then `dusk init`), NOT a dusk-monorepo package — its git history MUST be purely Dusk-authored and independently auditable. All application source SHALL be produced through the **CLI `dusk implement` path**, which wires the post-hoc gate `gateWorktreeEdits(worktreeRoot)` over the worktree diff (filtered by the shared `isGatedFile` predicate). The MCP `dusk_implement` write surface SHALL NOT be used to build, because it is gated-by-contract only (no live file-writing engine), so it would run the short cycle ungated. Dusk's gate and worktree machinery MUST resolve correctly against the external repo root (`$CLAUDE_PROJECT_DIR`-based install; worktree creation + `node_modules` symlink under the POC root). (Plan Phase 6 Scope; design D1, D2, D3; **P6-T1**.)

#### Scenario: A build request lands gated against the external repo

- **WHEN** `dusk implement <request>` runs against the standalone POC repo
- **THEN** the file-writing Engineer runs inside a worktree under the POC root with `node_modules` symlinked from the POC checkout
- **AND** `gateWorktreeEdits` filters the worktree diff by `isGatedFile` and blocks on any `runGate` rejection
- **AND** the resulting commit lands in the POC repo's history, not the monorepo's

#### Scenario: The external-repo path is de-risked before the real build

- **WHEN** Dusk is first pointed at a sibling repo outside the monorepo
- **THEN** worktree creation, the `node_modules` symlink strategy, and gate resolution all succeed against the external root
- **AND** any path assumption that breaks is fixed as a tightly-scoped dusk-repo change before the real build begins

### Requirement: The intent tree is born entirely through authoring dialogs at tree scale

The POC's entire intent tree (~10–20 intents) SHALL be authored through full-mode `dusk_author_*` dialogs in the canonical `sendNotification` domain. The tree SHALL contain ≥1 `polarity: negative` triple, ≥1 `compose: implies` intent with a closed-vocabulary antecedent (evaluated by deterministic index lookup, never LLM-judged), and pyramid children at the unit + integration + e2e layers. Stage-2 tension detection SHALL be exercised **as the tree grows** — later intents discover and classify earlier ones. Intents SHALL be authored with the implementation's realistic shape in mind; mismatches that block the long cycle SHALL be resolved by re-scoping through the dialog (a whitelisted human action), never by hand-editing code. (Plan Phase 6 Scope; RFC §5, §3.1, §3.2.1; design D7; **P6-T2**.)

#### Scenario: Every intent traces to an authoring dialog

- **WHEN** the tree is complete
- **THEN** every intent under the POC's `.ia/intents/` corresponds to an author-role event in the trace stream and a finalize `intents_created` record naming it
- **AND** the tree contains at least one `polarity: negative` triple, at least one closed-vocabulary `compose: implies` intent, and pyramid children at unit, integration, and e2e layers

#### Scenario: Tension detection fires as the tree grows

- **WHEN** a later intent is authored that relates to an earlier one
- **THEN** Stage-2 surfaces the tension and the dialog classifies the typed `relates_to` edge before finalize

### Requirement: The application's endpoints are built through the pipeline, including multi-bead and pause/resume flows

The 4–6 endpoints (across ~2 resources, including a cursor-paginated list and an idempotent write) SHALL be produced through `dusk_implement` requests. Among them: **≥1 request that decomposes to a multi-bead DAG with a file-overlap serialization edge** (a cross-cutting intent — e.g., structured-logging — overlapping an endpoint module), landing one commit per bead with full trailers in the documented order; and **≥1 naturally-occurring pause → author → resume loop** (a request referencing a not-yet-authored behavior → `implement_paused_for_authoring` → real dialog → `dusk_implement({resume_token})` → commit; checkpoint deleted). Recovery/livelock paths are recorded if they occur naturally, not artificially forced. (Plan Phase 6 Scope; RFC §6.2, §10.1.1; design D10; **P6-T5, P6-T6**.)

#### Scenario: A multi-bead request serializes on a file overlap

- **WHEN** a request decomposes to ≥2 beads where a cross-cutting intent overlaps an endpoint module
- **THEN** the DAG contains the serialization edge, the beads run in the documented order, and one commit per bead lands with the full v9 trailer set

#### Scenario: A missing intent pauses the build for authoring, then resumes

- **WHEN** a request references a not-yet-authored behavior mid-build
- **THEN** the pipeline returns `implement_paused_for_authoring` with the enriched seed
- **AND** after the real authoring dialog completes, `dusk_implement({resume_token})` lands a commit and the checkpoint is deleted

### Requirement: The full test pyramid executes against live infrastructure through the pipeline

The pipeline SHALL produce Verifier-validated integration + e2e **test bodies**; the Test Runner (vitest-only — it invokes `pnpm vitest run <files>` and provisions no infrastructure) SHALL execute them against a live database and the app's real HTTP surface. The live infrastructure SHALL be provisioned by the POC's own Vitest `globalSetup` (Postgres via docker-compose/testcontainers; an in-process app-boot helper for e2e), which the runner's `vitest run` honors because the worktree inherits the POC's Vitest config and symlinked `node_modules`. The two-stage satisfaction + livelock machinery is live across both layers. (Plan Phase 6 Scope; RFC §3.4, §6.6; design D8; **P6-T3, P6-T4**.)

#### Scenario: Integration tests run against live Postgres

- **WHEN** a `dusk_implement` run whose intent set includes an `…/integration-tests` child completes, with the POC's `globalSetup` providing live Postgres
- **THEN** the Test Runner's `vitest run` executes the pipeline-produced integration test bodies against real Postgres
- **AND** the `TestVerdict` satisfies the layer's `covers-*` triples and the commit carries `Test-Intent` + `Test-Verdict-id` trailers

#### Scenario: E2e tests run against the app's real HTTP surface

- **WHEN** a `dusk_implement` run whose intent set includes an `…/e2e-tests` child completes, with the POC's `globalSetup`/app-boot helper bringing up the HTTP surface
- **THEN** the Test Runner's `vitest run` executes the pipeline-produced e2e suite against the running app
- **AND** the `TestVerdict` satisfies the layer's `covers-*` triples and the commit carries the test trailers

### Requirement: The application works

The deliverable is a working API, not a trace stream. The POC app SHALL boot, its endpoints SHALL respond, and its semantics SHALL hold: cursor-pagination (opaque cursor, stable ordering) and idempotency (a duplicate write with the same key produces a single effect), verified through the app's own e2e suite. The full pyramid (all layers) SHALL be green against live infrastructure. (Plan Phase 6 Scope; Sprint 11 product bar; design D7, D8; **P6-T7**.)

#### Scenario: The booted app honors its semantics

- **WHEN** the POC app is booted and its e2e suite runs
- **THEN** the endpoints respond, cursor-pagination returns stable opaque-cursor pages, a duplicate idempotent write produces a single effect, and the full pyramid is green
