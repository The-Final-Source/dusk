## Context

Phase 6 is the first **v1.x** change and the first that **consumes** the finished v1 runtime rather than building it. It produces two artifacts: a standalone **POC application** (a small notifications API, built greenfield with zero hand-written application code) and the **mechanical proof** of how it was built (a trailer auditor, a transcript/provenance checker, and a `PocReport`). Every runtime seam it touches — the gate, the 9-step pipeline, `dusk_author`'s 5 stages, the Verifier, the test pyramid + Test Runner, commit trailers, pause/resume checkpoints, the livelock/recovery surfaces, the static-analysis detector, the observability trace stream — is consumed exactly as shipped in Phases 1–5. Phase 6 adds **no runtime capability** and pins **no new cross-proposal seam** (it is terminal for this line of work). The one new schema is `PocReport`; the one new mechanical contract is the *"application source"* predicate. Both are pinned below.

The structurally novel part is **cross-repo**: the build runs in a fresh repo *outside* this monorepo, driven by the installed/linked `dusk` CLI from here. The hardest risks are all about Dusk operating against an external working directory; they are de-risked first (D3).

## Goals / Non-Goals

**Goals:**
- A working, adherent notifications API (4–6 endpoints, ~2 resources) whose every line of application code was produced through `dusk_author` + `dusk_implement`, mechanically provable from the POC's `git log` alone.
- Exercise the three v1-residual gaps: the zero-hand-written-code thesis (P6-T1/T2), the full pyramid on real infrastructure (P6-T3/T4), and greenfield intent-tree authoring at application scale (P6-T2).
- Produce the audit tooling + `PocReport` as zero-model pure passes, verified against the *real* pipeline output, not fixtures.

**Non-Goals:**
- No legacy bootstrap (greenfield needs none — the point of the phase; RFC §8.2, App. D.23).
- No deferred v1.x feature (semantic/vector search, runtime canonical-library fetch, noun-phrase expansion, heterogeneous per-role models, hard sandboxing). Wanting one means off-scope.
- No reshaping of any v1 runtime capability. The only permissible dusk-repo code change is a tightly-scoped robustness fix the greenfield load genuinely surfaces (D11) + the trivial `dusk implement --help` flag fix.
- No feature-complete product (4–6 endpoints, not forty).

## Decisions

### D1 — Two repositories, with an explicit per-command repo boundary

The POC is a **fresh standalone git repo** (`git init` from zero), NOT a dusk-monorepo package — its history must be purely Dusk-authored and independently auditable, which a monorepo package's shared history cannot be. The **dusk monorepo** holds the OpenSpec change, the audit tooling, the `PocReport` schema, and any friction commits; it drives the installed/linked `dusk` CLI + MCP server. The **POC repo** holds only the application. Every task states which repo its commands run in. The trailer auditor reads the **POC** repo's `git log`; `openspec validate` runs in the **dusk** repo. *Alternative considered:* a monorepo sub-package — rejected because its git history is inseparable from v1's hand-written history, defeating P6-T1's audit.

### D2 — The CLI `dusk implement` path is the only build surface; the MCP write surface is not used to build

All application source is produced through the **CLI `dusk implement`** path, which wires the post-hoc gate `gateWorktreeEdits(worktreeRoot)` over the worktree diff (it runs `git status --porcelain -z -uall`, filters by `isGatedFile` — `.ts`/`.tsx` excl. `.d.ts`, plus `.intent` — and blocks on any `runGate` rejection). The MCP `dusk_implement` write surface is **gated-by-contract only**: it requires a `gate` callback but no live entrypoint constructs a file-writing engine through it, so driving the build through MCP would run the short cycle **ungated**. Using the CLI path is therefore a correctness requirement, not a preference. `dusk_author` *is* driven through its MCP/CLI dialog surface (reads/writes only intent files under the gate); only the *implement* write path must be CLI.

### D3 — De-risk Dusk-against-an-external-repo before anything else

Everything depends on `dusk` operating on an external working directory. Before authoring a single intent, prove against a *sibling* repo: (1) worktree creation under the POC root; (2) the `node_modules` symlink strategy the dogfood-grade `dusk implement` uses (worktree Vitest with `node_modules` symlinked from the main checkout — here the POC's own `node_modules`); (3) gate resolution — install uses `$CLAUDE_PROJECT_DIR` (cwd-independent), `checkHook` expands it against the passed `root`, and `gateWorktreeEdits`/worktree resolution compute paths relative to the target repo. If any path assumption breaks against an external root, that is a legitimate tightly-scoped dusk-repo fix (D11). The Phase-5 dogfood ran `dusk implement` *inside* `packages/shared`; the external-root case is genuinely new and is the first thing the tasks prove.

### D4 — The "application source" predicate is enumerated, not improvised

The trailer auditor's central classifier must crisply separate *required* code (pipeline-produced, trailer-required) from *exempt scaffold* (may be hand-authored). Ruled here, not in the script:
- **Required (pipeline-produced + decorated):** all runtime application source **and all test bodies** under the configured pyramid suffixes (`unit-tests`/`integration-tests`/`e2e-tests`). The test bodies prove P6-T3/T4 were Dusk-produced.
- **Exempt scaffold (may be hand-authored, minimal, enumerated):** the `dusk init` output; `package.json`/`tsconfig`/`vitest.config`/Drizzle config; generated migrations; and the **Vitest infrastructure provisioning** — the `globalSetup` that spins up Postgres + the e2e app-boot helper. This is the honest line: the *test bodies* are the deliverable; the *infra harness* that lets them run is scaffold. The exempt set is kept minimal and decorated where it is genuinely code. The predicate is encoded as an explicit allowlist of exempt paths/globs; anything else under the source tree is *required*.

### D5 — The trailer auditor is a zero-model pure pass, verified against a real pipeline `git log`

The auditor walks the POC's full history; for every commit touching *required* application source it asserts the full v9 trailer set is present (actual keys, fixed App. A.7 order, from `packages/runtime/commit/src/render.ts`: `Intent`, `Test-Intent`*, `Bead-id`, `Verdict-id`, `Test-Verdict-id`?, `Trace-id`, `Verifier-model`, + conditionals `Partial`?/`Deferred-Intent`*/`Verifier-bypassed-test-intent`*) **or** that the commit is a merge of such commits. It then asserts the human-input whitelist (dialog responses, `dusk_implement` requests, `dusk_resolve_livelock`/recovery resolutions, commit review/merge approval) covers every recorded human action. **It is verified against the real `git log` of an actual pipeline run in the POC repo, never a synthesized commit shape** — the load-bearing P0-gate lesson: that gate "passed" its author's check because the check drove the internal `{tool,args}` test shape, never the real `{hook_event_name,tool_name,tool_input}` wire payload, so it "blocked" only by *crashing*. An auditor that passes on hand-built commit fixtures has the identical blind spot. *Determinism:* zero model calls — pure parse of `git log` output.

### D6 — Provenance is asserted against durable records, not the dialog directory

`dusk_author_finalize` **destroys** `.ia/runtime/dialogs/<id>/` (the Phase-4 contract), so live transcripts do not survive authoring. For every intent under the POC's `.ia/intents/`, the transcript checker asserts a correlating **author-role event in the observability trace stream** (`traces.jsonl`, `role: "author"`) plus the finalize record (`FinalizeResult = { intents_created: string[] }`) naming it. It also asserts the tree contains ≥1 `polarity: negative` triple, ≥1 `compose: implies` with a closed-vocabulary antecedent, and pyramid children at unit + integration + e2e layers. *Design choice (not a runtime change):* if the negotiation text is to be published with the reference repo, each transcript is copied to a durable POC artifact **before** finalize. *Determinism:* zero model calls.

### D7 — The intent tree: the notifications domain, authored at tree scale

~10–20 intents authored entirely through full-mode `dusk_author_*` dialogs, in the canonical-intents / App. B `sendNotification` domain so the Author's Stage-2 tension detection and Stage-3 proposals operate on familiar ground. Required constructs: a cursor-paginated list (pagination intents), an idempotent write under a `compose: implies` idempotency-on-writes intent (closed-vocabulary antecedent — evaluated by deterministic index lookup, never LLM-judged), structured-logging + error-handling cross-cutting intents, and ≥1 `polarity: negative` triple. **Stage-2 tension detection is exercised as the tree grows** — later intents must discover and classify earlier ones (the gap P4-T1 left, having only run one intent at a time). Intents are authored *with the implementation's realistic shape in mind* — the Phase-5 dogfood's recurring friction was over-strict intents blocking the long cycle; mismatches are resolved by re-scoping (whitelisted), never by hand-editing code.

### D8 — The full pyramid on live infra: the Test Runner provisions nothing; the POC's `globalSetup` does

The Test Runner is **vitest-only** — it invokes `pnpm vitest run <files>` via `@dusk/runtime-test-runner` and provisions no infrastructure. Live Postgres + the booted HTTP surface come from the **POC's own Vitest `globalSetup`** (Postgres via docker-compose/testcontainers; an in-process app-boot helper for e2e), which the runner's `vitest run` honors because the dogfood-grade `dusk implement` runs worktree Vitest with `node_modules` symlinked, so the worktree inherits the POC's Vitest config + `globalSetup`. This `globalSetup` is *exempt scaffold* (D4). P6-T3 (integration vs real Postgres) and P6-T4 (e2e vs real HTTP) are the **first real-code, real-infra pyramid runs** — the Phase-3 machinery only ran on fixtures, so expect to exercise the two-stage satisfaction + livelock paths for real, and to need an ambient Postgres reachable from the worktree. Each test layer's commit carries `Test-Intent` + `Test-Verdict-id` trailers; the `TestVerdict` must satisfy the layer's `covers-*` triples.

### D9 — `PocReport`: a new sibling schema in `@dusk/core-schema`, modeled on `DogfoodReport`'s pattern, not reusing it

`DogfoodReport`'s gating section is `.strict()`-locked to its own four dogfood thresholds (`e2e_implement_success_count`, `gate_false_positive_count`, `worked_example_regression`, `package_test_suite`); the POC's hard gates differ and are **more**, so a literal reuse is impossible. `PocReport` follows the same *structure*: a `.strict()` **gating** section + a `gating: z.literal(false)` **exploratory** section (the no-blended-metrics rule, enforced structurally). The gating fields: zero hand-written application code, all endpoints pipeline-landed (mergeable commits), full pyramid green on live infra, gate false-positive rate = 0, intent tree 100% dialog-authored, static analysis clean in both modes — each a `.strict()` `{ value, threshold, pass }` gated metric mirroring `DogfoodReport`'s `gatedCount` helper. The exploratory fields: dialog turn counts, Stage-3 proposal acceptance rate, iteration distributions, pause/resume frequency, intent-granularity stats, time-to-endpoint. The schema lives in `packages/core/schema` (barrel-exported from `@dusk/core-schema`); the evaluator that fills it (a zero-model pure pass over `git log` + `traces.jsonl` + `dusk doctor` output) and the trailer auditor + transcript checker live under `packages/runtime/benchmark` (extension — the same home as the dogfood evaluator).

### D10 — Pipeline breadth comes from natural greenfield flow, not artificial forcing

P6-T5 (multi-bead file-overlap) is produced by a real request where a **cross-cutting intent** (e.g., structured-logging) overlaps an endpoint module → the Decomposer's overlap machinery emits the serialization edge → the beads run in documented order → one commit per bead with full trailers. P6-T6 (pause→author→resume) is produced by a request referencing a **not-yet-authored** behavior mid-build → `implement_paused_for_authoring` with the enriched seed → the real dialog → `dusk_implement({resume_token})` completes with a commit → checkpoint deleted. Recovery/livelock paths are **recorded if they occur naturally, not artificially forced** (the plan's explicit instruction).

### D11 — Runtime defects surfaced by the greenfield load: scoped fix + regression + spec delta

Likely, given Phase 5 found six. Handled exactly as the dogfood did: a tightly-scoped fix in the affected dusk package + a regression test + a living-spec delta if behavior was mis-specified ("archives are history; main specs are the contract" — the Phase-4 board's adopted policy). This is in-scope **support** work, distinct from the Phase-6 deliverable; it does not balloon into reshaping a capability. The trivial `dusk implement --help` flag-visibility fix (`--scope`, `--base-ref`) is made early since both flags are used constantly.

## Risks / Trade-offs

- **Dusk-against-an-external-repo path assumptions break** → de-risk first (D3) against a throwaway sibling repo; any break is a scoped D11 fix before the real build begins.
- **The auditor has a blind spot identical to the P0 gate** → verify it against a *real* pipeline `git log`, never a synthesized fixture (D5); add a deliberately-malformed-commit negative case to prove it actually rejects.
- **Over-strict authored intents block the long cycle** (the recurring Phase-5 friction) → author with realistic code shape in mind (D7); resolve mismatches by re-scoping (whitelisted), never by hand-edit.
- **Ambient Postgres unreachable from the worktree** → the POC `globalSetup` owns provisioning (D8); confirm the worktree (symlinked `node_modules`, inherited config) can reach it during the de-risk step, not mid-build.
- **The exempt-scaffold set quietly grows to launder hand-written code** → the set is enumerated and minimal (D4); each exempt path is justified in the design; the auditor treats anything not on the allowlist as *required*.
- **A real defect tempts a hand-edit to "save time"** → forbidden; the auditor would catch it and, more importantly, it would make the POC a lie. Stalls are resolved only through whitelisted surfaces (§4.2).

## Migration Plan

Post-v1, additive, and **in a separate repo** — no migration of existing v1 state. Sequence: (1) de-risk Dusk-against-external-repo + land the `--help` flag fix (dusk repo); (2) `git init` + `dusk init` the POC repo; (3) author the intent tree through real dialogs; (4) build the endpoints via `dusk implement` (incl. the multi-bead/overlap run + the natural pause→author→resume); (5) wire + run the full pyramid against live Postgres + real HTTP; (6) build + run the audit tooling against the real `git log`; (7) produce the `PocReport`. Rollback is trivial: the POC repo is discardable and the dusk-repo additions are isolated to new files under `@dusk/core-schema` + `packages/runtime/benchmark` plus the one-line help fix.

## Open Questions

- **Postgres provisioning mechanism** — docker-compose vs testcontainers for the POC `globalSetup`. Decided at de-risk time (D3/D8) based on which is reachable from the worktree on this host; either is exempt scaffold.
- **Transcript publication** — whether to copy dialog transcripts to a durable POC artifact before finalize (D6). A publication nicety, not required for P6-T2 (which asserts against `traces.jsonl` + the finalize record). Defaulting to *yes* so the reference repo carries the negotiation text.
