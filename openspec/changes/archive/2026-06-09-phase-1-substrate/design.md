## Context

Phase 1 is the substrate every later phase reads and writes against: the constraint language on disk (`intent.yaml` + code decoration) and the PreToolUse gate that enforces decoration completeness at write time. It contains **no sub-agent and no model in the loop** — it is pure deterministic machinery, so correctness is a matter of parsing, indexing, and gating, not LLM behavior. The design choices below mostly concern package boundaries, the parser's negation rule, the in-memory index shape, and the out-of-process hook. Motivation lives in `proposal.md`; the normative requirements live in `specs/`. The architecture authority is `docs/rfcs/001-mvp-rfc/` (Ch. 2–4, App. A) and the implementation plan's Phase 1.

## Goals / Non-Goals

**Goals:**
- Round-trip intents through Zod-validated schemas with automatic forward migration of older corpora.
- Parse all six decoration markers + `.intent` files into structured records and answer five index query types + hierarchical satisfaction in memory.
- Run the 10-check PreToolUse gate (→ 12 typed rejection kinds) out-of-process with fail-safe blocking, installed idempotently and never clobbering.
- Ship `dusk init/validate/inspect/doctor` and the Phase-1 test harness later phases build on.

**Non-Goals:**
- No Verifier, spawn mechanism, MCP server, or pipeline step — and **no model call** anywhere in Phase 1.
- No `S ⊆ D` decorate-or-decompose gate check (it is Phase-5 `doctor --static-analysis` drift detection).
- No session-snapshot / per-bead-delta index layering (that is Phase 3, built on top of the same query interface defined here).
- TypeScript decoration only; no embeddings, no runtime-fetched canonical library.

## Decisions

### D1 — Clean cutover: discard the v5-era scaffolding, build `packages/core/*` fresh

This phase is a **clean cutover** to the v9 architecture defined in `docs/rfcs/001-mvp-rfc`. The pre-v9 tooling packages — `packages/schema` (`@dusk/schema`: annotation/audit/constraint/enums), `packages/parser` (`@dusk/parser`: blockFile/auditFile/configFile), and `packages/cli` (`@dusk/cli`) — implement the **dismantled** Block / Constraint / audit / source-map model and are **removed**, not extended (the roadmap's "What changed vs v4" lists these concepts as gone). The v9 substrate is built fresh as separate pure-leaf `@dusk/*` packages — `schema`, `parser`, `graph`, `decoration`, `index` under `packages/core/*` (plus `delivery/pre-tool-use` and the new `dusk` CLI) — with `composite: true` tsconfig references, mirroring the roadmap layout and the "one concept per file/package" rule. `schema` is the deepest leaf (only Zod); everything derives TS types via `z.infer` — never a hand-written `type` duplicating a schema. Because the legacy packages are removed, the new packages' names are unconstrained (e.g. `@dusk/core-schema`); pick clean, consistent names and verify nothing in the production app (`api`/`web`/`shared`/`hooks`/`mobile`) imported the removed packages before deleting them. *Alternative considered:* a single `@dusk/core` package with subpaths — rejected because the packages have genuinely independent consumers (Phase 2 Verifier imports `index` + `schema` but not `parser`), and separate packages keep the dependency graph and build ordering explicit. *Alternative considered:* coexisting with the legacy packages — rejected per the explicit cutover directive (no half-migrated state).

### D2 — Negation detector is a ~200-LOC POS-aware scanner, no ML

The §3.1.1 matrix/constituent rule is positional + lexical (reject the closed lexicon in the matrix predicate slot; allow constituent negation inside subject/object NPs). A lightweight auxiliary-adjacency scanner implements it deterministically. *Alternative:* a full NLP dependency parser — rejected: nondeterministic, heavy, and unnecessary for a closed lexicon. The detector is the one **unit-only** component (a ~40-case corpus, P1-T3) because it is a pure transform with no I/O; its wiring is exercised through the gate (P1-T11) and the parser.

### D3 — The derived index is rebuilt-in-memory, never persisted

Per RFC §2.9 the index is regenerable, not an artifact. Phase 1 builds the **single-session** form (scan files → records → query maps). Phase 3 will layer the session-snapshot + per-bead delta over the *same query interface* (D6) — so this phase pins the interface, not the snapshot mechanics. *Alternative:* a persisted index (e.g. SQLite) — rejected: stale-state liability, and satisfaction is cheap to recompute.

### D4 — The PreToolUse gate is an out-of-process CLI binary that fails safe

Claude Code invokes the hook as a command (`node …/pre-tool-use-hook/cli.js`) with stdin/stdout JSON (App. A.10). The handler is a thin wrapper around the 10 checks; **any uncaught throw is converted to `block` with `hook_internal_error`** before exit so a crash can never silently approve. The 10 checks emit 12 typed `Rejection` kinds (some checks split — see App. A.8); conformance is tested per-kind (P1-T10). *Alternative:* an in-process gate — rejected: the hook contract is out-of-process, and testing the real binary over stdin (the real-hook invoker) is the honest integration test.

### D5 — `dusk init` merges settings.json by `_dusk_marker`, never by position or content

Re-runs and foreign hooks make array-position or content-equality matching fragile. The `_dusk_marker` anchor makes install idempotent; a conflicting non-Dusk Write/Edit entry triggers the three-option prompt (append / replace-with-backup / abort). *Alternative:* overwrite-on-init — rejected as a silent footgun (the round-3 board fix).

## Cross-change interface seams (pinned here; later phases consume them)

These shapes are the contract other changes bind to — they are frozen in this phase:

- **Schema types** — `Intent`, `Triple` (affirmative slots + `polarity`/`quantifier`/`scope`), `ComposeRule`, five-kind `RelatesTo`, the closed-vocabulary antecedent union (App. A.1). Consumed by every later phase.
- **Decoration record** — `{ file, line, scope, declaration_name|null, marker, intent_path, aspect_ids[]|null, support_triple|null, ignore_clause|null }` (App. A.2). Consumed by `index` and the Phase-2 Verifier.
- **Derived-index query interface** — forward / reverse / focal+support / aspect-rollup / test-discovery + hierarchical satisfaction. Phase 2 (Verifier scoping) and Phase 3 (universe, overlap, snapshot) bind to *this interface*; Phase 3 swaps the backing store (snapshot + delta) without changing the signatures.
- **`Rejection` union + `HookInput`/`HookOutput`** (App. A.8/A.10). The gate is per-session — the Phase-3 Engineer's writes flow through this same contract.
- **`dusk.config.yml` shape** — `test_pyramid.suffixes`, `sanity.*`, `models.*`, `test_runner.*`. Read by everything.
- **Test harness** — the temp-repo factory and the real-hook invoker interfaces (used by every later phase's integration tests), plus the injectable-`Clock` convention (D7).

## Determinism & test strategy

Phase 1 has **no model and no Verifier**, so every behavioral test runs against **real dependencies** — real file system, real `git init` temp repos, and the **real hook process** — with no doubles needed. The negation detector (P1-T3) is the only unit-only test. There is no scripted-verdict-Verifier-double usage in this phase.

### D6 — The injectable `Clock` convention ships in Phase 1; D7 — the Verifier double is deferred to Phase 2 (justified deviation)

The plan lists four shared-infra items "landing in Phase 1": temp-repo factory, real-hook invoker, scripted-verdict Verifier double, injectable clock. Two of these are genuinely exercisable now (temp-repo factory + real-hook invoker, used by the gate/init/doctor tests). The **injectable `Clock` interface** is established here as a convention (all time reads go through an injected `now()`), even though nothing in Phase 1 reads time meaningfully — so Phase 3/4 TTL/GC/drain tests are deterministic by construction. The **scripted-verdict Verifier double doubles the Verifier interface, which is not defined until Phase 2** — a double for an undefined interface cannot be built or tested cohesively. Per the "honest, cohesive-landing" rule, Phase 1 therefore ships the harness it can exercise and the `Clock` convention, and the Verifier double lands in Phase 2 alongside the interface it doubles. This is a deliberate, minor deviation from the plan's literal wording, made to keep Phase 1's landing genuinely cohesive (everything it ships is exercised by a Phase-1 test).

## Risks / Trade-offs

- **[Index interface churn]** Phase 3 layers snapshot + delta over the D3 index → if the D6 query interface is wrong, Phase 3 pays. *Mitigation:* design the interface from the Phase-2/3 consumers' needs (focal/support scoping, universe, overlap) now, not just Phase-1's.
- **[Negation false positives/negatives]** A closed-lexicon scanner can mis-handle an edge phrase. *Mitigation:* the ~40-case corpus encodes the known matrix-vs-constituent boundary cases (P1-T3); failures expand the corpus, never loosen the rule.
- **[settings.json shapes vary]** Real projects have diverse `.claude/settings.json`. *Mitigation:* match only by `_dusk_marker`; never assume array position; back up on replace; `doctor --check-hook` round-trips a synthetic payload to detect drift.

## Migration Plan

Greenfield new packages — no rollback of existing behavior. `dusk init` is additive and idempotent; the only externally-visible mutation is the `.claude/settings.json` hook entry (backed up on replace). Build ordering via Turbo `^build` (schema → dependents).

## Open Questions

- Exact `.intent` precedence vs function-level decoration when both touch a directory's files — deferred to the Phase-2 Verifier scoping work; Phase 1 only records both.
- Whether `dusk inspect`'s satisfaction view should pre-compute or lazily query large trees — a performance question, not a correctness one; defer until dogfooding shows a need.
