# Handoff Prompt — Implement Dusk Phase 1 (Substrate)

> Paste this whole file as the opening prompt for a **fresh Claude Code session**. It contains everything needed to implement Phase 1 of the Dusk v9 architecture accurately. The final instruction tells you exactly how to begin.

---

## 0. Your task in one paragraph

You are implementing **Phase 1 — Substrate** of the Dusk v9 architecture. The work is already fully specified as an **OpenSpec change** at `openspec/changes/phase-1-substrate/` (proposal + 7 capability specs + design + a dependency-ordered task list). Your job is to **build the code that satisfies that change**, working the task checklist top to bottom, writing the behavioral tests as you go, until the Phase-1 **cohesive-landing criteria** all pass — then the change is ready to archive. **Do not redesign anything**: the architecture, the capability slicing, the decisions, and the acceptance tests are settled. Read the source-of-truth docs, then execute. **To begin, run `/openspec-apply-change` (target the `phase-1-substrate` change).**

---

## 1. Mental model — what Dusk is

Dusk is a **constraint-satisfaction system for spec-driven AI development**. The endgame: humans stop reading/writing code and instead express **intents** via agent dialog; an orchestration harness turns intents into perfectly implemented, *adherent* code. Three layers:

1. **Constraint language** — **Intents** (atomic, hierarchical via slash-namespaced path) + **total code decoration**. The intent *is* the assertion; there is no separate "constraint" or "block" layer.
2. **Solver** — nine bounded sub-agent roles drive a 9-step request→commit pipeline (later phases).
3. **Verifier** — multi-agent evaluation checks code against the constraints per-aspect (later phases).

**Phase 1 is the substrate every later layer stands on**: the intent files + decoration on disk, the in-memory index that reads them, and the PreToolUse gate that mechanically enforces decoration at write time. **Phase 1 has no sub-agent and no model in the loop** — it is pure deterministic machinery, so it must be airtight.

Delivery model (NON-NEGOTIABLE): **one OpenSpec change per plan phase.** You are doing exactly Phase 1's scope — nothing from later phases leaks in, and Phase 1 ships *whole* (no "we'll wire it up next phase").

---

## 2. Read these FIRST, in this order (source of truth)

| # | Path | Why |
|---|---|---|
| 1 | `CLAUDE.md` (repo root) | Project conventions, build/test commands, behavioral + security rules. |
| 2 | `openspec/config.yaml` | The OpenSpec project context + rules injected into every artifact. Authoritative summary of the architecture, stack, standards, and the per-phase delivery model. |
| 3 | `docs/rfcs/001-mvp-rfc/v9-implementation-plan.md` → **Phase 1 — Substrate** | THE CONTRACT. Read the Conventions block + the entire Phase 1 section. Tests **P1-T1 … P1-T21**, the phase-landing smoke test, and the cohesive-landing criteria are your acceptance bar. |
| 4 | `docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md` | The architecture spec. For Phase 1 read **Ch. 2 (Artifacts), Ch. 3 (Constraint Language), Ch. 4 (Decoration Model + the PreToolUse gate §4.6/§4.6.1), App. A (schemas A.1–A.3, A.8, A.10), App. B (worked example — the canonical decorated file)**. Cite § numbers in code comments/commits where useful. |
| 5 | `docs/rfcs/001-mvp-rfc/intent-architecture-roadmap.md` → **Sprints 1–2** | The build decomposition for Phase 1 + the locked architectural-commitments table. Also read "What changed vs v4" (what was REMOVED). |
| 6 | `openspec/changes/phase-1-substrate/proposal.md` | Why + the 7 capabilities + non-goals + acceptance. |
| 7 | `openspec/changes/phase-1-substrate/design.md` | HOW: the 5 key decisions (D1–D5), the **pinned cross-change interface seams**, the determinism strategy, and the **Verifier-double deferral (D7)**. |
| 8 | `openspec/changes/phase-1-substrate/specs/*/spec.md` (7 files) | The normative requirements + WHEN/THEN scenarios — each scenario maps 1:1 onto a P1-Tn test. |
| 9 | `openspec/changes/phase-1-substrate/tasks.md` | Your execution checklist (9 groups, dependency-ordered). |
| 10 | `.praxis/features/{adding-packages.md, coding-guidelines.md, testing.md, overview.md}` | How to add a package and the established code style — follow these exactly. |

Use `openspec show phase-1-substrate` and `openspec status --change phase-1-substrate` to view the change; `openspec validate phase-1-substrate --strict` to validate.

---

## 3. What you're building — the 7 capabilities

Each capability has a spec (`specs/<name>/spec.md`) and maps to a v9 package. All packages are new `@dusk/*` ESM packages; Zod is the **source of truth** for every type (`z.infer`, never a hand-written duplicate).

| Capability | New package | Delivers | Tests |
|---|---|---|---|
| `intent-schema` | `packages/core/schema` | Zod schemas for Intent / Triple (`polarity`,`quantifier`,`scope`) / ComposeRule / five-kind RelatesTo / closed-vocab antecedent union; path-to-id + reserved-suffix rules; the forward-migration loader. | P1-T1 |
| `intent-parser` | `packages/core/parser` | Lossless round-trip read/write (atomic temp+rename); the POS-aware `negation-detector` (matrix/constituent rule, no ML); antecedent-grammar validation. | P1-T2, P1-T3, P1-T4, P1-T20 |
| `intent-graph` | `packages/core/graph` | Path + typed-`relates_to` (5 kinds) traversal; cycle detection; test-pyramid children resolution. | P1-T7 |
| `decoration-parser` | `packages/core/decoration` | The six markers (`@intent`/`@intent-support`/`@intent-test`/`@intent-test-file`/`@intent-file`/`@intent-ignore`) + `.intent` files → structured records. | P1-T8, P1-T16 |
| `derived-index` | `packages/core/index` | Forward / reverse / focal+support / aspect-rollup / test-discovery queries + hierarchical satisfaction rollup (through test-pyramid children). | P1-T5, P1-T6, P1-T17 |
| `pretooluse-gate` | `packages/delivery/pre-tool-use` | The stdin/stdout hook handler: 10 mechanical checks → **12 typed rejection kinds**, fail-safe blocking, approve on clean writes, `supersedes` gate-warn. | P1-T9, P1-T10, P1-T11, P1-T12, P1-T18, P1-T21 |
| `dusk-cli-substrate` | `packages/cli` (new v9 CLI) | `dusk init` (`_dusk_marker` idempotent settings merge + three-option conflict prompt + scaffold), `validate`, `inspect`, `doctor --check-hook [--repair]`. | P1-T13, P1-T14, P1-T15, P1-T19 |

Plus: six canonical example intents under `packages/intents/canonical` (also parser/graph fixtures), and the **shared test harness** (temp-repo factory + real-hook invoker + the injectable-`Clock` convention).

---

## 4. ⚠️ Existing repo state — this is a CLEAN CUTOVER, discard the old scaffolding

This phase is a **complete cutover to the v9 architecture** in `docs/rfcs/001-mvp-rfc`. Any previous (pre-v9) Dusk-tooling scaffolding is **discarded**, not coexisted-with.

**DISCARD — the pre-v9 / v5-era tooling packages (tasks.md §1.0) — ✅ ALREADY DONE.** `packages/schema` (`@dusk/schema`), `packages/parser` (`@dusk/parser`), and `packages/cli` (`@dusk/cli`) have already been removed via `git rm` (they implemented the dismantled Blocks/Constraints/`.block.yaml`/`audit.json`/source-map model). Do not recreate or revive them. **Your first action: run `pnpm install` and accept its "remove and reinstall from scratch?" prompt** to reconcile the lockfile after the removal — then start at tasks.md §1.1. The five production app packages (`api`/`web`/`shared`/`hooks`/`mobile`) remain and must stay untouched.

**KEEP — production app packages, untouched in Phase 1** (the v9 architecture explicitly keeps these; they become dogfood targets in Phase 5, so they are *not* "old scaffolding"): `packages/api`, `packages/web`, `packages/shared`, `packages/hooks`, `packages/mobile`. Before deleting the legacy tooling packages, confirm none of these app packages import them (they shouldn't — the app uses `@dusk/shared`); if one does, stop and surface it to the user rather than guessing a replacement.

**Build fresh — the v9 substrate** at the design D1 paths: `packages/core/{schema,parser,graph,decoration,index}`, `packages/delivery/pre-tool-use`, the new `dusk` CLI, `packages/intents/canonical`. Because the legacy packages are removed, names are unconstrained — pick clean, consistent `@dusk/*` names (e.g. `@dusk/core-schema`). The `dusk` CLI is brand new; it does **not** inherit the legacy `@dusk/cli` command semantics.

Other current state: there is **no** `dusk.config.yml` and **no** `.ia/` directory yet — `dusk init` creates them (Phase 1 builds that). The monorepo is pnpm workspaces + **Turborepo** (not NX, despite older RFC text). `pnpm-workspace.yaml` (glob `packages/*`), `turbo.json`, `tsconfig.base.json` exist at root.

---

## 5. How to build it — standards, structure, seams

**Code standards** (from `CLAUDE.md` + `.praxis/features/coding-guidelines.md` — follow exactly):
- Functional-first: functions > classes (classes only for long-lived mutable state with lifecycle). Factory functions (closures) for config-holding objects.
- **Zod schema = source of truth**; derive TS via `z.infer`. **Named exports only** (no default exports). `type` over `interface`. **Result objects internally** (`{ success, error }`) — no throwing across module boundaries; the gate's fail-safe is the one place a thrown error is converted to a structured `block`.
- Config via injection — only an `env.ts`-style module reads `process.env`. One concept per file; **files < 500 lines**; extract only at 3+ repetitions. **Colocated tests** (`x.ts` + `x.test.ts`). Import order: node builtins → external → internal packages → relative.
- camelCase filenames, UPPER_SNAKE_CASE constants, `is/has/can` booleans.

**Package conventions** (`.praxis/features/adding-packages.md` — follow exactly): `"type": "module"`, `"private": true`, `exports` field, `workspace:*` internal deps, `composite: true` in tsconfig for libraries, barrel `src/index.ts` (consumers import the package name, never internal paths), `vitest.config.ts`. Turbo handles build ordering via `^build` — no manual ordering.

**Pin these cross-change interface seams** (design.md) — later phases bind to them, so get the shapes right now: the **schema types** (App. A.1), the **decoration record** (App. A.2), the **derived-index query interface** (Phase 3 swaps the backing store — snapshot+delta — behind the *same* signatures), the **`Rejection` union + `HookInput`/`HookOutput`** (App. A.8/A.10), and the **`dusk.config.yml` shape** (`test_pyramid.suffixes`, `sanity.*`, `models.*`, `test_runner.*` — see the roadmap's config block).

**Gate specifics** (App. A.10, §4.6.1): the hook reads stdin JSON `{tool, args, session_id, transcript_path}`, writes stdout `{decision:"approve"}` or `{decision:"block", reason, structured_rejection}`, exits 0 in both cases; **any uncaught throw → `block` with `structured_rejection.kind:"hook_internal_error"`** (never a silent approve). The 10 checks emit 12 typed `Rejection` kinds (some checks split — App. A.8). `dusk init` installs it into `.claude/settings.json` keyed by `_dusk_marker:"dusk-pre-tool-use-gate"` (+ `_dusk_managed`), idempotent by marker, with a three-option conflict prompt (append / replace-with-backup / abort) — **never silently clobber.**

---

## 6. Testing discipline — Phase 1 is fully deterministic

Vitest, colocated. Behavioral, **integration-first against REAL dependencies** (Khorikov): real file system, real `git init` temp repos, and the **real hook process** (pipe a `HookInput` to the installed gate binary over stdin and read `HookOutput`). **No model and no Verifier exist in Phase 1**, so there is nothing to mock — every test is deterministic.

- Assert **observable outcomes** (a returned record, an index query result, a satisfaction rollup, a `structured_rejection.kind`, a CLI exit code, a file on disk) — never internal call sequences or private field names.
- The **only unit-only test** is the `negation-detector` corpus (~40 cases) — a pure transform with no I/O; its wiring is exercised through the gate (P1-T11) and parser.
- Build the **shared test harness** early (tasks.md §1.2): the temp-repo factory and real-hook invoker are used green by the later tests. Establish the **injectable `Clock`** convention (no direct `Date.now()`). **The scripted-verdict Verifier double is deferred to Phase 2** (design D7) — it doubles a Phase-2 interface, so do not build it now.
- Every task in `tasks.md` names its acceptance (a spec scenario / P1-Tn) and a test plan — implement the test alongside the code, not after.

Build/verify commands (`CLAUDE.md`): `pnpm build` (turbo, schema first), `pnpm test`, `pnpm typecheck`. **Run tests after changes; verify build + typecheck before committing.**

---

## 7. Definition of done = the Phase-1 cohesive-landing criteria (the archival gate)

Do not consider Phase 1 complete (or archive the change) until **all** of these hold (from the plan's Phase 1 "Cohesive landing criteria" + tasks.md §9.3):

- [ ] All P1-T1…P1-T21 behavioral tests pass against real dependencies (real FS + real hook process).
- [ ] The **phase-landing smoke test** ("substrate end-to-end on a fresh repo", tasks.md §9.2) is green.
- [ ] `dusk init`, `dusk validate`, `dusk inspect`, `dusk doctor`, `dusk doctor --check-hook` are operable with working `--help`.
- [ ] No carry-over: the index exposes **all five** query types + satisfaction rollup — none stubbed.
- [ ] The six canonical intents parse/validate/inspect; the negation-detector corpus is green; migration of a real legacy fixture is green.
- [ ] The gate is the **only** installed hook; `_dusk_marker` idempotency + the conflict-prompt paths are exercised.
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck` all pass; `openspec validate phase-1-substrate --strict` passes.

When green, archive the change with `/openspec-archive-change` (or `openspec archive phase-1-substrate --yes`).

---

## 8. Workflow & guardrails

- **Drive from the task list.** Use `/openspec-apply-change` to work `tasks.md` in order; check off `- [ ]` → `- [x]` as you complete each, and let the specs/design inform each step.
- **Commit discipline.** Conventional commits (use the `/atomic-commits` flow). Logical, atomic commits — group by capability/package or task group. Code commits use `feat`/`test`/`fix`/`refact`/`build`/`chore`; OpenSpec-document commits use `spec:`. End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. This repo commits to `main` directly for this work. Commit/push only when the work is at a sensible checkpoint.
- **Do not touch** the production app packages `packages/api|web|shared|hooks|mobile`. **Delete** the legacy `@dusk/schema|parser|cli` (tasks.md §1.0) — do not import from or revive them.
- **No new root files** (CLAUDE.md rule). New code lives under `packages/`. Tests are colocated.
- **Follow the plan + RFC; do not redesign.** If you find a genuine contradiction between the spec/design and the RFC/plan, or a destructive reconciliation choice (e.g. replacing the legacy CLI), surface it to the user rather than guessing.
- **Honest over flattering:** if a test fails, say so with the output; never blend mechanical vs semantic; no silent behavior — surface conflicts/truncations explicitly (the `DuskError`/structured-rejection ethos applies to your own reporting too).

---

## 9. Decisions already made (do not relitigate)

- **D1** `packages/core/*` are separate pure-leaf packages; Zod is the sole source of truth.
- **D2** Negation detector is a ~200-LOC POS-aware scanner (no ML); unit-only corpus test.
- **D3** The derived index is rebuilt-in-memory, never persisted (Phase 3 layers snapshot+delta over the same interface).
- **D4** The gate is an out-of-process CLI binary that **fails safe** (throw → `hook_internal_error` block).
- **D5** `dusk init` merges `.claude/settings.json` by `_dusk_marker`, never by position/content; three-option conflict prompt; never clobber.
- **D7** The scripted-verdict **Verifier double is deferred to Phase 2** (it doubles a Phase-2 interface). Phase 1 ships the temp-repo factory, real-hook invoker, and the injectable-`Clock` convention.
- The gate has **10 checks → 12 typed rejection kinds**; the agentic `S ⊆ D` decorate-or-decompose mandate is **NOT** a gate check (it's Phase-5 `doctor --static-analysis`).
- Polarity model: triple slots are always **affirmative**; negation is the structural `polarity` field (the runtime would invert post-LLM — but **no LLM runs in Phase 1**; the parser/gate only enforce that authors don't smuggle matrix-predicate negation into slots).

---

## 10. ▶ BEGIN

1. Read §2's documents (at minimum: `CLAUDE.md`, `openspec/config.yaml`, the plan's Phase 1 section, the change's `proposal.md` / `design.md` / `tasks.md` / `specs/*`, and `.praxis/features/adding-packages.md` + `coding-guidelines.md`).
2. Run `pnpm install` (accept the "reinstall from scratch?" prompt) to reconcile the lockfile after the §1.0 cutover. **Task 1.0 is already complete** (the legacy packages are gone) — begin at tasks.md §1.1.
3. **Run `/openspec-apply-change`** (target the `phase-1-substrate` change) and implement `tasks.md` from §1.1 top to bottom — widen the `pnpm-workspace.yaml` globs for the nested `packages/core/*` layout, mirror an existing package (`packages/shared`) for `package.json`/`tsconfig.json`/`vitest.config.ts` conventions, and write the behavioral tests alongside the code — until the §7 cohesive-landing criteria all pass.

Build for right. Land the plane.
