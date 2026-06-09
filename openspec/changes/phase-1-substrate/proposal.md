## Why

Every later phase reads and writes against the substrate — the constraint language on disk and the gate that enforces decoration at write time. Until intent files parse into a coherent in-memory index and the PreToolUse gate mechanically blocks malformed decoration, nothing above it (the Verifier, the 9-step pipeline, authoring) can be trusted. This change delivers **Phase 1 — Substrate** of the implementation plan (roadmap Sprints 1–2): pure deterministic machinery — no sub-agent, no model in the loop — so it must be airtight.

Grounded in `docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md` (Ch. 2–4, App. A) and the implementation plan's **Phase 1** (tests P1-T1…P1-T21). This is one OpenSpec change for one plan phase, per the delivery model.

## What Changes

- New `@dusk/*` packages: `packages/core/{schema,parser,graph,decoration,index}`, `packages/delivery/pre-tool-use`, `packages/cli`; plus six canonical example intents under `packages/intents/canonical` and the Phase-1 shared **test harness** (temp-repo factory, real-hook invoker, and the injectable-`Clock` convention; the scripted-verdict Verifier double lands in Phase 2 with the Verifier interface it doubles — see design D7).
- Intent files parse → a validated **Intent** with **Triple** slots that are always affirmative English plus the structural `polarity`, `quantifier`, and `scope` fields; `compose: all | any | none | implies` where the **implies** antecedent group is restricted to a closed predicate vocabulary; and five-kind typed `relates_to`. Older corpora migrate forward automatically (`negated → polarity`, flat `relates_to → sibling`, `refines → parent`). (RFC §2.1, §3.1–3.2.1, App. A.1.)
- Code decoration parses into structured records for the six markers — `@intent` (focal), `@intent-support` (with inline NL triple), `@intent-test`, `@intent-test-file`, `@intent-file`, `@intent-ignore` — plus `.intent` directory files. The in-memory **derived index** answers forward / reverse / focal+support / aspect-rollup / test-discovery queries and hierarchical satisfaction (including reserved test-pyramid children). (RFC §2.4–2.10, §3.3.)
- The **PreToolUse gate** runs 10 mechanical checks → 12 typed rejection kinds, fails safe on internal error, and is installed idempotently by `dusk init` via the `_dusk_marker` merge with a three-option conflict prompt (never a silent clobber). (RFC §4.6, §4.6.1, App. A.8/A.10.)
- `dusk` CLI surface: `init`, `validate`, `inspect`, `doctor --check-hook [--repair]`.

## Capabilities

### New Capabilities
- `intent-schema`: Zod schemas (source of truth) for Intent, Triple (polarity/quantifier/scope), ComposeRule, five-kind RelatesTo, and the closed-vocabulary antecedent discriminated union; path-to-id + reserved-suffix rules; the forward-migration loader. (P1-T1)
- `intent-parser`: deterministic round-trip read/write (atomic temp+rename), the POS-aware `negation-detector` matrix/constituent rule, antecedent-grammar validation. (P1-T2, P1-T3, P1-T4, P1-T20)
- `intent-graph`: recursive load + path-id resolution, upward/downward traversal, typed `relates_to` resolution (all five kinds), cycle detection, and test-pyramid-children resolution. (P1-T7)
- `decoration-parser`: the six decorator markers + `.intent` directory files parsed into structured decoration records (marker, intent_path, aspect_ids, support_triple, ignore_clause, file:line). (P1-T8, P1-T16)
- `derived-index`: forward, reverse, focal/support, aspect-rollup, and test-discovery queries, plus hierarchical satisfaction rollup through test-pyramid children. (P1-T5, P1-T6, P1-T17)
- `pretooluse-gate`: the stdin/stdout hook handler running 10 checks → 12 typed rejection kinds, fail-safe blocking, approve on clean writes, and the `supersedes` gate-warn. (P1-T9, P1-T10, P1-T11, P1-T12, P1-T18, P1-T21)
- `dusk-cli-substrate`: `dusk init` (`_dusk_marker` idempotent merge + three-option conflict prompt + scaffold), `validate`, `inspect`, and `doctor` / `doctor --check-hook [--repair]` (exit 0/2/3). (P1-T13, P1-T14, P1-T15, P1-T19)

### Modified Capabilities
None — `openspec/specs/` is empty; this is the foundational change.

## Non-goals (deferred — do not pull in)

- No sub-agent runtime, spawn mechanism, MCP server, Verifier procedure, or any pipeline step (Phases 2–3). **No model is called in Phase 1.**
- The decorate-or-decompose (`S ⊆ D`) mandate is intentionally NOT a gate check — it ships as drift detection via `dusk doctor --static-analysis` in Phase 5.
- Multi-language decoration (TypeScript only), embeddings/vector search, and any runtime-fetched canonical intent library are deferred per the roadmap's "What's deferred to v1.x".

## Verifiability / acceptance

Success = all Phase-1 behavioral tests pass against **real dependencies** (real file system + the **real hook process**), per the plan: migration (P1-T1), round-trip (P1-T2), negation-detector corpus (P1-T3, unit-only), antecedent grammar (P1-T4), satisfaction rollup through test children (P1-T5), scoped focal/support query (P1-T6), cycle detection (P1-T7), marker parsing (P1-T8), gate approve + all 12 rejection kinds + check-10 negation + fail-safe (P1-T9–T12), `dusk init` idempotency + three-option conflict prompt (P1-T13, P1-T14), `doctor --check-hook` exit codes + scoped `--repair` (P1-T15), and `.intent` scope, configurable suffixes, ignore vocabulary, `validate` precision, atomic write, and `supersedes` gate-warn (P1-T16–T21). The **phase-landing smoke test** ("substrate end-to-end on a fresh repo") is green.

The **Phase-1 Cohesive landing criteria are the archival gate**: this change is not archived until every box passes — all P1 tests green against real deps, the smoke test green, the CLI/doctor surfaces operable with `--help`, no carry-over (all five index query types + satisfaction rollup live, not stubbed), and the gate is the only installed hook with `_dusk_marker` idempotency exercised.

## Impact

- **Clean cutover to v9.** This change **discards the pre-v9 (v5-era) tooling scaffolding** — `packages/schema` (`@dusk/schema`), `packages/parser` (`@dusk/parser`), `packages/cli` (`@dusk/cli`), which implement the dismantled Block / Constraint / audit / source-map model — and builds the v9 substrate fresh. Nothing imports from the removed packages.
- New packages: `packages/core/{schema,parser,graph,decoration,index}`, `packages/delivery/pre-tool-use`, the new `dusk` CLI, `packages/intents/canonical`, + the shared test harness. Pure leaf deps (Zod).
- The **production app packages `api`/`web`/`shared`/`hooks`/`mobile` are untouched** — the v9 architecture (`docs/rfcs/001-mvp-rfc`) keeps them; they become dogfood targets in Phase 5, not part of the discarded scaffolding.
- `dusk init` writes `dusk.config.yml`, the `.ia/*` scaffold, role-file stubs, and a `.claude/settings.json` PreToolUse hook entry (the gate). Turbo handles build ordering via `^build`.
