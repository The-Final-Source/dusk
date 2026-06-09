> Ordered by dependency (schema is the leaf; nothing references a later task). Each task names its acceptance (spec scenario / P1-Tn) and a Vitest test plan. Phase 1 has no model and no Verifier — every behavioral test runs against real dependencies (real file system + real hook process); only the negation detector is unit-only.

## 1. Cutover: remove legacy scaffolding, scaffold v9 packages & test harness

- [ ] 1.0 **Cutover — discard the pre-v9 (v5-era) tooling packages.** Confirm nothing in the production app (`api`/`web`/`shared`/`hooks`/`mobile`) imports them, then remove `packages/schema` (`@dusk/schema`), `packages/parser` (`@dusk/parser`), and `packages/cli` (`@dusk/cli`) — they implement the dismantled Block/Constraint/audit/source-map model. Acceptance: those directories are gone, `pnpm-workspace` resolves, `pnpm build`/`typecheck` pass with no dangling references. If any app package *does* import a removed package, stop and surface it to the user (do not guess a replacement).
- [ ] 1.1 Create the v9 packages fresh per `.praxis/features/adding-packages.md` — `packages/core/{schema,parser,graph,decoration,index}`, `packages/delivery/pre-tool-use`, the new `dusk` CLI, `packages/intents/canonical` — with clean, consistent `@dusk/*` names (e.g. `@dusk/core-schema`), `type:module`, `private:true`, `exports`, `composite:true`, tsconfig references, colocated Vitest config; wire Turbo `^build`. Acceptance: `pnpm build`/`typecheck` pass; dep graph is schema→dependents (scaffolding — no behavioral test).
- [ ] 1.2 Build the **temp-repo factory** (throwaway `git init` repo with `.ia/`, `dusk.config.yml`, chosen fixtures) and the **real-hook invoker** (pipes `HookInput` to the installed gate binary over stdin, reads `HookOutput`). Acceptance: both used green by §7; Test: self-test that the factory yields a valid repo and the invoker round-trips a trivial approve.
- [ ] 1.3 Establish the injectable `Clock` convention (`now()` injected; never direct `Date.now()`). Acceptance: convention doc + lint guard; exercised by later phases. Note (design D7): the scripted-verdict Verifier double is deferred to Phase 2 with the Verifier interface it doubles.

## 2. intent-schema  (spec: intent-schema)

- [ ] 2.1 Define Zod schemas in `packages/core/schema` — Intent, Triple (`polarity`/`quantifier`/`scope`), ComposeRule, five-kind RelatesTo, closed-vocabulary antecedent discriminated union; types via `z.infer`; path-to-id + reserved-suffix rules. Acceptance: spec "Intent schema is Zod-defined", scenarios *valid intent validates* / *path-to-id mismatch rejected* / *implies antecedent closed vocabulary*; Test: schema validation tests over valid + malformed fixtures.
- [ ] 2.2 Implement the forward-migration loader (`negated→polarity`, flat `relates_to→sibling`, `refines→parent`) with a deprecation warning per construct. Acceptance: **P1-T1** / spec *Older intent corpora migrate forward*; Test: integration test loading a real legacy fixture asserting the three transforms + warnings.

## 3. intent-parser  (spec: intent-parser)

- [ ] 3.1 Implement read (`intent.yaml`→Intent) and canonical deterministic write (stable field + triple ordering) with atomic temp+rename. Acceptance: **P1-T2** round-trip + **P1-T20** atomic write / spec *round-trip losslessly and atomically*; Test: round-trip integration + simulated-crash-between-temp-and-rename test.
- [ ] 3.2 Implement `negation-detector.ts` (POS-aware matrix/constituent rule, closed lexicon, no ML) with the ~40-case corpus. Acceptance: **P1-T3** / spec *Negation detection follows the matrix/constituent rule*; Test: **unit-only** corpus test (pure transform, no I/O).
- [ ] 3.3 Implement antecedent-grammar validation for `compose: implies` (closed vocab + resolvable refs, else `decoration_parse_error`). Acceptance: **P1-T4** / spec *implies antecedent grammar validated at load*; Test: integration test rejecting behavioral/type-system antecedents, accepting a decorator-fact antecedent.

## 4. intent-graph  (spec: intent-graph)

- [ ] 4.1 Recursive load + path-id resolution + upward/downward traversal + typed `relates_to` resolution (all five kinds). Acceptance: spec *graph resolves hierarchy and typed edges*; Test: traversal integration over a fixture tree asserting ancestors/descendants + per-kind edge recording.
- [ ] 4.2 Cycle detection on `relates_to` edges of any kind. Acceptance: **P1-T7** / spec *Cycle detection*; Test: cyclic-fixture rejection naming both intents.
- [ ] 4.3 Test-pyramid children resolution (`X/<configured-suffix>`). Acceptance: spec *Test-pyramid children resolution*; Test: pyramid-child resolution over a configured suffix.

## 5. decoration-parser  (spec: decoration-parser)

- [ ] 5.1 Parse the six markers over TypeScript into decoration records (inline support triple + `because`/`reason` ignore clause). Acceptance: **P1-T8** / spec *six decorator markers parse to structured records*; Test: parse a fixture exercising all six markers, asserting one record per occurrence with all fields + `file:line`.
- [ ] 5.2 Parse `.intent` directory files (one claim per line). Acceptance: **P1-T16** / spec *.intent directory-scope files*; Test: directory-claim parse + multi-claim-line rejection.

## 6. derived-index  (spec: derived-index)

- [ ] 6.1 Build the in-memory index + the five queries (forward / reverse / focal+support / aspect-rollup / test-discovery). Acceptance: **P1-T6** / spec *answers all decoration queries*; Test: focal/support scoping integration over an App.B-style fixture (returns only that aspect's focal+support; excludes other aspects).
- [ ] 6.2 Hierarchical satisfaction rollup through test-pyramid children. Acceptance: **P1-T5** / spec *satisfaction rolls up through test children*; Test: rollup integration — unsatisfied child blocks parent, satisfying it flips parent to satisfied.
- [ ] 6.3 Configurable test-pyramid suffixes end-to-end (config → graph resolution → test-discovery layer keying). Acceptance: **P1-T17** / spec *suffixes configurable end-to-end*; Test: add `contract-tests`, assert resolution + layer keying.

## 7. pretooluse-gate  (spec: pretooluse-gate)

- [ ] 7.1 Implement the hook handler + wire format (stdin/stdout JSON, exit 0 both ways) + fail-safe (any throw → `block` with `hook_internal_error`). Acceptance: **P1-T9** approve + **P1-T12** fail-safe / spec *wire format and fail-safe*; Test (real-hook invoker): clean-write approve + truncated-JSON fail-safe.
- [ ] 7.2 Implement the 10 mechanical checks emitting all 12 typed `Rejection` kinds, including `@intent-ignore` vocabulary. Acceptance: **P1-T10** + **P1-T18** / spec *ten checks → twelve kinds*; Test: one fixture per App. A.8 kind piped through the real hook, asserting the exact `structured_rejection.kind` + `file:line`.
- [ ] 7.3 Implement check 10 — matrix-predicate negation in an `@intent-support` predicate (reuse `negation-detector`). Acceptance: **P1-T11** / spec *Check 10*; Test: negated-support block (hint to polarity-decision) + affirmative approve.
- [ ] 7.4 Implement the `supersedes` gate-warn (non-blocking). Acceptance: **P1-T21** / spec *Gate warns on superseded intent*; Test: supersedes fixture warns and does not block.

## 8. dusk-cli-substrate  (spec: dusk-cli-substrate)

- [ ] 8.1 `dusk init`: scaffold (`dusk.config.yml`, `.ia/*`, role-file stubs) + `_dusk_marker` idempotent settings.json merge + three-option conflict prompt (never clobber). Acceptance: **P1-T13** + **P1-T14** / spec *init installs idempotently and never clobbers*; Test (temp repo): fresh + idempotent re-run by marker; conflict append/replace-with-backup/abort.
- [ ] 8.2 `dusk doctor --check-hook [--repair]` (exit 0/2/3; `--repair` re-runs merge for config issues only, never auto-fixes round-trip failures). Acceptance: **P1-T15** / spec *check-hook verifies installation*; Test: exit-code matrix + scoped-repair.
- [ ] 8.3 `dusk validate` (file:line precision; non-zero on defect, 0 when clean). Acceptance: **P1-T19** / spec *validate reports defects with file:line*; Test: malformed-fixture file:line + exit codes.
- [ ] 8.4 `dusk inspect` (intent + decoration claims + hierarchical-satisfaction view) and `dusk doctor` base (all 10 checks project-wide). Acceptance: spec *inspect shows intents and decoration claims*; Test: inspect output over a fixture with an unsatisfied test child.

## 9. Canonical intents, smoke test & cohesive landing

- [ ] 9.1 Author the six canonical example intents at the v9 paths under `packages/intents/canonical` (also serve as parser/graph fixtures). Acceptance: they parse, validate, and inspect; Test: `dusk validate` over all six is green.
- [ ] 9.2 Phase-landing smoke test — "substrate end-to-end on a fresh repo": `dusk init` → drop intents → `dusk validate` → write the App.B-style decorated file through the **installed hook** (approve) → introduce one violation per gate check (each blocked with the correct kind) → `dusk inspect` (rollup shows unsatisfied unit-tests child) → `dusk doctor --check-hook` (exit 0). Acceptance: plan Phase-1 smoke test green; Test: one e2e Vitest scenario in a temp repo.
- [ ] 9.3 Verify the **Cohesive landing criteria** (archival gate): all P1 tests green vs real deps; `init`/`validate`/`inspect`/`doctor`/`doctor --check-hook` operable with working `--help`; the index exposes all five query types + satisfaction rollup (none stubbed); the gate is the only installed hook with `_dusk_marker` idempotency exercised; migration of a real legacy fixture is green.
