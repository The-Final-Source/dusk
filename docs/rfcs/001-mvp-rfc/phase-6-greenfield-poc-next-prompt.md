# Handoff Prompt — Phase 6: Greenfield POC (the second v1.x change — its prerequisite, universal-decoration-coverage, lands first)

> Paste this whole file as the opening prompt for a **fresh Claude Code session**. It contains everything needed to scaffold and implement Phase 6 of the Dusk v9 architecture accurately. **This is post-v1**: it begins only after the Phase-5 change has archived and v1 is landed. Unlike Phases 1–5, Phase 6's OpenSpec change does **not** exist yet — your first job is to author it from the plan brief, then implement it. The final instruction tells you exactly how to begin.

---

## 0. Your task in one paragraph

You are implementing **Phase 6 — the Greenfield POC** of the Dusk v9 architecture: building a small but real **API application from `git init` with zero hand-written application code** — every line of application source produced through `dusk_author` + `dusk_implement`, mechanically auditable from the commit-trailer record. This is the first **v1.x** change; it proves the v9 thesis ("humans express intents; the harness produces adherent code") in its pure form on Dusk's native greenfield terrain, runs the full test pyramid against live infrastructure on real non-fixture code, and exercises greenfield intent-tree authoring at application scale. Two differences from every prior phase: **(1)** the OpenSpec change `phase-6-greenfield-poc` is NOT scaffolded yet — your first job is to scaffold it (`/openspec-new-change`) and author its proposal/design/specs/tasks **from the already-written plan brief** (`docs/rfcs/001-mvp-rfc/v9-implementation-plan.md` Phase 6, lines 839–923), then implement it via `/openspec-apply-change`; **(2)** you work across **two repositories** — the dusk monorepo (where the OpenSpec change, the trailer-audit tooling, and any friction-driven role/skill commits live) and a **brand-new standalone POC repo** (where the application is built, with its own pure-Dusk git history). **Before doing anything, confirm two archived changes** under `openspec/changes/archive/`: the Phase-5 change (v1 landed) AND **`universal-decoration-coverage`** — Phase 6's v1.x prerequisite (RFC App. D.28), which adds the per-file `<file>.intent` sidecar that lets the POC's comment-less `package.json`/configs be decoration-covered and reach the 100%-coverage bar. If either is missing, stop and surface it — the POC is post-v1 and its prerequisite lands first (§6.1).

---

## 1. Mental model — what Dusk is, and why greenfield is its native mode

Dusk is a **constraint-satisfaction system for spec-driven AI development**. The endgame: humans stop reading/writing code and express **intents** via agent dialog; an orchestration harness turns intents into perfectly implemented, *adherent* code. Three layers:

1. **Constraint language** — **Intents** (atomic, hierarchical via slash-namespaced path) + **total code decoration**. The intent *is* the assertion. (Phase 1.)
2. **Solver** — nine bounded sub-agent roles drive a 9-step request→commit pipeline: `dusk_implement`. (Phases 2–3.) Plus the 5-stage authoring dialog: `dusk_author`. (Phase 4.)
3. **Verifier** — multi-agent evaluation with scoped focal+support evidence at `temperature: 0`, wired through the short cycle, long cycle, and two-stage test satisfaction.

**Why greenfield, and why now.** v9 is designed greenfield-first: decoration happens *at authorship*, code is authored for AI consumption, and the whole apparatus — total decoration, the gate, per-aspect verification — is cheapest and highest-fidelity when every line is born decorated. RFC §8.2 defers *legacy bootstrap* (retro-decorating >20kLOC) precisely because that is the *un*-native mode. Yet v1 never tested the native mode purely. The v1 dogfood (P5-T11) was brownfield-lite: it decorated *existing* code on a *pure-leaf* package (`packages/shared` — no DB, no HTTP, unit-only pyramid). Phase 6 closes the three residual gaps in one artifact: **(a)** the thesis itself — has never run with zero hand-written application code; **(b)** the full test pyramid — has never executed against real infrastructure (live Postgres, real HTTP) on real non-fixture code; **(c)** greenfield intent-tree authoring at application scale — Stage-2 tension detection as a tree grows from nothing, only ever exercised one intent at a time (P4-T1). The deliverable: a small working API that exists only because Dusk built it.

---

## 2. Read these first (source of truth)

Read these in order. Do not skim — the plan brief is the material you will turn into the OpenSpec artifacts.

1. **`docs/rfcs/001-mvp-rfc/v9-implementation-plan.md` — Phase 6 (lines 839–923).** THE PRIMARY BRIEF. Its Outcome is your proposal's "why," its Scope is the "what changes," its Behavioral tests **P6-T1..T8** + the phase-landing smoke are the "how we know it's right," and its Cohesive landing criteria are the "definition of done." You are authoring the OpenSpec change directly from this section — read it as the spec for the artifacts you must write.
2. **`docs/rfcs/001-mvp-rfc/intent-architecture-roadmap.md` — Post-v1 Sprint 11 (line 939).** The roadmap framing: goal, why-this-is-the-right-first-v1.x-move, what-gets-built, the human-input whitelist, done-means, and the "requires no deferred v1.x feature" note.
3. **`docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md`** — the v9 architecture spec. For Phase 6 specifically:
   - §8.2 (greenfield is native; bootstrap is the inverse) + App. D.23 (the post-v1 sequencing decision record — read this for *why* Phase 6 is first and requires no deferred feature)
   - §5 (the 5-stage authoring flow — you will author ~10–20 intents through it)
   - §3.1 / §3.1.1 (polarity; you must author ≥1 `polarity: negative` triple)
   - §3.2.1 (`compose: implies` closed-vocabulary antecedents; you must author ≥1)
   - §3.4 + §6.6 (the test pyramid + the Test Runner — **note the runner is vitest-only and provisions NO infrastructure**; live Postgres + the e2e app-boot come from the POC's own Vitest `globalSetup`, which the runner's `vitest run` honors — see §6.6)
   - §6.2 (file-overlap bead serialization — you must drive ≥1 multi-bead run with an overlap edge)
   - §6.7 + App. A.7 (commit trailers — the trailer set is the mechanical proof of zero-hand-written-code)
   - §10.1.1 (pause/resume — a natural pause→author→resume loop must occur mid-build)
   - §4.1 + §8.9 (total decoration completeness + static-analysis; born-decorated code must show zero erosion under `dusk doctor --static-analysis`)
4. **`openspec/specs/`** — the canonical capability specs (≈32 capabilities, all of v1, after Phase 5 archives). Phase 6 **consumes** these; it does not modify them. You are not adding capabilities to the dusk runtime — you are *using* the finished runtime to build an application. (If Phase 6 needs a small runtime fix — e.g., a robustness gap the greenfield load surfaces — that is an in-dusk-repo capability change, scoped tightly and spec-delta'd like any other; see §6.5.)
5. **The five archived `design.md` files** under `openspec/changes/archive/` (phases 1–5). These pin every seam Phase 6 binds: the parser/decoration/index substrate; `SubAgentTrace`/`Verdict`/`ModelClient`/the scripted-verdict double/`raw_prompt` capture/injectable `Clock`; the full 9-step pipeline + `CommitTrailers` + import-adjacency; `DialogState`; and the Phase-5 observability/benchmark/static-analysis surfaces + the `DogfoodReport` shape (`packages/core/schema/src/dogfoodReport.ts`) whose two-section gating/exploratory *pattern* you model `PocReport` on — **not** a literal reuse (its gating section is `.strict()`-locked to the four dogfood thresholds; the POC's gates differ and are more — see §3).
6. **The Phase-5 implementation summary + the P0 gate/paths hardening that followed it** (dusk repo history). Critical operational context — verify these symbols exist before you lean on them (they were all confirmed present as of this writing):
   - **`dusk implement` is dogfood-grade** (`packages/cli/src/implement.ts`): a file-writing headless Engineer in the bead worktree, worktree-fresh Verifier context, worktree Vitest with `node_modules` symlinked from the main checkout, flags `--scope <intent,..>` and `--base-ref <ref>` (note: these two flags work but are **omitted from `dusk implement --help`** — a trivial fix worth making early since you'll use them constantly).
   - **The headless Engineer is gated POST-HOC in-process by `gateWorktreeEdits(worktreeRoot)`** (`packages/cli/src/implement.ts`), NOT via the interactive PreToolUse hook — it runs `git status --porcelain -z -uall` over the worktree diff, filters by the shared **`isGatedFile`** predicate (`.ts`/`.tsx` excl. `.d.ts`, plus `.intent`; `packages/delivery/pre-tool-use/src/rejections.ts`), and blocks on any `runGate` rejection. This is the wired file-writing gate.
   - **The interactive gate** uses **`normalizeHookInput`** to accept both the real Claude Code payload `{hook_event_name, tool_name, tool_input}` and the internal `{tool, args}` shape; it installs with `$CLAUDE_PROJECT_DIR` (cwd-independent, works against an external repo); `checkHook` gates on the `_dusk_managed: "v2"` marker + firing-shape. (The hard-won lesson behind all this: see §6.6.)
   - **Six robustness defects** the dogfood already fixed: stdin EPIPE in `claude` spawns; stray-tool `error_max_turns`; a null-aspect `@intent-test-file` empty-cover bug; group-worktree lookup for non-first beads; missing production transport retry; over-strict authored intents blocking the long cycle. **Phase 6 leans on all of this harder** — more `dusk_implement` runs, multi-bead DAGs, integration/e2e beads. Expect to surface more (handle per §6.5).
7. **`CLAUDE.md`** at the dusk repo root — project conventions (TS strict ESM, pnpm workspaces + Turborepo, Vitest, functional-first, Zod source-of-truth, named exports, etc.). **The POC repo follows the same conventions** (it is built on Dusk's own stack) but is its **own** repo, not a monorepo package.
8. **`openspec/config.yaml`** — the per-phase delivery model (one OpenSpec change per phase). When you scaffold `phase-6-greenfield-poc`, add the one-line Post-v1 entry to its phase-order note (the v9 plan flagged this as deliberately deferred until now).

---

## 3. The contract (don't soften it)

### What ships in Phase 6

A fresh standalone repository containing a small but real API application — cursor-paginated reads, an idempotent write endpoint, Drizzle + Postgres persistence, structured logging, a full unit/integration/e2e test pyramid running against live infrastructure — in which **every line of application code was produced through `dusk_author` + `dusk_implement`**, mechanically auditable via the commit-trailer record. Human contributions are confined to an enumerated whitelist: authoring-dialog responses, `dusk_implement` requests, livelock/recovery resolutions, and commit review/merge approval. Nothing else.

### Specifically (P6-T1..T8 + the deliverable)

- **The POC target** — a fresh **standalone git repo** (NOT a dusk-monorepo package; its git history must be purely Dusk-authored and independently auditable), `dusk init` from zero. A minimal **notifications API** on Dusk's own stack (TypeScript strict ESM, Express + tRPC, Drizzle + Postgres, Vitest) — deliberately the canonical-intents / App. B `sendNotification` domain so the Author's Stage-2/Stage-3 machinery works on familiar ground. 4–6 endpoints across ~2 resources: a cursor-paginated list, an idempotent write (under a `compose: implies` idempotency-on-writes intent), structured-logging + error-handling cross-cutting intents, full pyramid with integration-tests (real Postgres) + e2e-tests (real HTTP) children.
- **P6-T1 — zero hand-written application code, mechanically audited.** A trailer-audit script (zero-model pure pass over `git log`) verifies every commit touching application source carries the full v9 trailer set (actual keys, from `packages/runtime/commit/src/render.ts`: `Intent`, `Test-Intent`, `Bead-id`, `Verdict-id`, `Test-Verdict-id`, `Trace-id`, `Verifier-model`, … + the gated-path conditionals `Partial`/`Deferred-Intent`/`Verifier-bypassed-test-intent`) or is a merge of such commits; the human-input whitelist covers every recorded human action. All writes go through the **CLI `dusk implement`** path (gate wired via `gateWorktreeEdits`) — see §5.2.
- **P6-T2 — the intent tree is born entirely through dialogs.** Provenance is asserted against **durable records, not the dialog directory**: `dusk_author_finalize` *destroys* `.ia/runtime/dialogs/<id>/` (Phase-4 contract), so live transcripts don't survive authoring. Assert each intent against a correlating author-role event in the trace stream (`traces.jsonl`, `role: author`) + the finalize `intents_created` record. The tree contains ≥1 `polarity: negative` triple, ≥1 `compose: implies` with a closed-vocabulary antecedent, and pyramid children at unit + integration + e2e layers. (If you want the negotiation text published with the reference repo, copy each transcript to a durable artifact *before* finalize — a design choice, not a runtime change.)
- **P6-T3 — integration tests execute against live Postgres through the pipeline.** First real-infra integration run outside fixtures; `TestVerdict` satisfies the layer's `covers-*` triples; commit carries `Test-Intent` + `Test-Verdict-id` trailers.
- **P6-T4 — e2e tests execute against the app's real HTTP surface through the pipeline.**
- **P6-T5 — a multi-bead, file-overlap-serialized request lands on real code** (cross-cutting intent overlapping an endpoint module → serialization edge; one commit per bead, full trailers).
- **P6-T6 — the pause → author → resume loop closes naturally mid-build** (a request referencing a not-yet-authored behavior → `implement_paused_for_authoring` → real dialog → resume → commit; checkpoint deleted).
- **P6-T7 — the application works** (boots; endpoints respond; cursor-pagination + idempotency semantics hold via the app's own e2e suite; full pyramid green). An adherent-but-broken app falsifies the thesis just as surely as hand-written code.
- **P6-T8 — born-decorated code shows zero erosion** (`dusk doctor --static-analysis` conservative → zero unresolved `S ⊄ D`; `--strict-unknowns` → zero `undecorated_callee` in application code). The strongest available evidence for the greenfield-first posture.
- **`PocReport`** — a **new sibling schema** in `@dusk/core-schema` modeled on `DogfoodReport`'s two-section *pattern* (gating + `gating: false` exploratory), NOT a literal reuse: `DogfoodReport`'s gating section is `.strict()`-locked to its own four dogfood thresholds, and the POC's hard gates differ and are more — zero hand-written code, all endpoints pipeline-landed, full pyramid green on live infra, gate false-positive rate = 0, tree 100% dialog-authored, static-analysis clean both modes — structurally separated from exploratory friction data (dialog turn counts, Stage-3 acceptance rate, iteration distributions, pause/resume frequency, intent-granularity stats, time-to-endpoint).

### Non-goals (do NOT introduce)

- **No legacy bootstrap.** Greenfield needs none — that is the entire point (RFC §8.2, D.23).
- **No deferred v1.x feature** — semantic/vector search, runtime canonical-library fetch, noun-phrase expansion, heterogeneous per-role models, hard sandboxing, etc. Phase 6 requires none of them; if you find yourself wanting one, you are off-scope.
- **No reshaping of any v1 runtime capability.** Phase 6 consumes the finished runtime. The only permissible dusk-repo code change is a tightly-scoped robustness fix the greenfield load genuinely surfaces (§6.5) — and that is a normal spec-delta'd capability change, not a Phase-6 deliverable.
- **No feature-complete product** — the POC is a small real app proving the thesis, not a shippable notifications service. 4–6 endpoints, not forty.

---

## 4. Build philosophy — HARD constraints (do not soften)

### 4.1 Build the RIGHT thing the RIGHT way

No deference, no shortcuts, no hand-written application code to "save time." The phase ships **whole** — every P6 test passes, every cohesive-landing checkbox is true, the trailer audit is clean, then the change archives.

### 4.2 The thesis constraint is the gate, and it is mechanical

The defining property — zero hand-written application code — is not honor-system. P6-T1's trailer auditor is a zero-model pass over `git log`: every application-source commit carries the full v9 trailer set or is a merge of such. If you ever hand-edit application code to unblock yourself, you have falsified the POC. When the pipeline gets stuck, you resolve it through the *whitelisted* surfaces (dialog responses, recovery-ladder/livelock resolutions, re-scoped requests) — exactly as the Phase-5 dogfood operator did when authored intents were stricter than feasible code. Friction is data, not a license to hand-write.

### 4.3 Khorikov classical / behavior-focused testing

Same posture as v1: test observable behavior, real dependencies first. For Phase 6 the "real dependencies" are emphatic — **real frontier model** (ambient Claude Code CLI, no API key, `temperature: 0`, the pre-registered transport-failure amendment applied), **real git**, **real Postgres**, **real HTTP**, **real Vitest**. The P6 *verification* artifacts (the trailer auditor, the transcript checker, the `PocReport` evaluator) are zero-model pure passes. The *build itself* runs the production pipeline against the real model.

### 4.4 Phase ships whole — cohesive landing is the archival gate

When you think you're done, run the Phase-6 cohesive-landing checklist (plan lines 915–923) against reality: all P6 tests green; the smoke scenario green end-to-end; the hard gates true; exploratory data recorded as non-gating in the `PocReport`; friction fed back into dusk role prompts/skills as reviewed commits; the POC repo publishable as the canonical greenfield reference. Then `/openspec-archive-change phase-6-greenfield-poc`.

---

## 5. Cross-repo + cross-seam model (the structurally novel part)

### 5.1 Two repositories

- **The dusk monorepo** (this repo) holds: the `phase-6-greenfield-poc` OpenSpec change; the trailer-audit script + transcript checker + `PocReport` evaluator (these are Phase-6 *tooling/tests*, live under the change's package or `packages/runtime/benchmark` extension per your design); and any friction-driven role/skill commits. The installed/linked `dusk` CLI + MCP server are driven from here.
- **The POC repo** (fresh, standalone) holds: the application. `git init` from zero, `dusk init`, then the entire intent tree + all application source + the full test pyramid — produced through the pipeline. Its git history is the audit subject; it must contain **no** hand-written application commits.

Be explicit at every step about which repo a command runs in. The trailer auditor reads the **POC** repo's `git log`; the OpenSpec validation runs in the **dusk** repo.

### 5.2 dusk must be runnable against an external repo — and via the CLI path

The POC is outside the monorepo, so `dusk` (CLI + the gate hook) must operate on an external working directory. Two specifics:

- **Use the CLI `dusk implement` path, not the MCP write surface.** The CLI path wires `gateWorktreeEdits` over the worktree diff — the file-writing Engineer is gated. The MCP `dusk_implement` write surface is **gated-by-contract only** (`writeSurface.ts` requires a `gate` callback but no live entrypoint constructs a file-writing engine through it). Driving the build through MCP would run the short cycle **ungated**. CLI is the correct, gated path for every build request.
- **The gate is external-repo-safe** — install uses `$CLAUDE_PROJECT_DIR` (cwd-independent), `checkHook` expands it against the passed `root`, and `gateWorktreeEdits`/worktree resolution compute paths relative to the target repo (no hardcoded monorepo root). Still, **de-risk it first**: the Phase-5 dogfood ran `dusk implement` *inside* `packages/shared`; running it against a *sibling* repo is the first thing to prove in your design (worktree creation, `node_modules` symlink strategy, and gate resolution all against an external root). If a path assumption breaks, that's a legitimate tightly-scoped dusk-repo fix (§6.5).

### 5.3 Phase 6 BINDS all of v1, reshapes nothing

Every seam — the gate, the 9-step pipeline, `dusk_author`'s 5 stages, the Verifier, the test pyramid + Test Runner, commit trailers, pause/resume checkpoints, the livelock/recovery surfaces, the static-analysis detector, the observability trace stream — is consumed as shipped. Phase 6 adds no runtime capability. It pins no new cross-proposal seam (it is terminal for this line of work). What it produces is an *application* + the *audit tooling* that proves how the application was built.

---

## 6. Implementation approach — how to actually do this

### 6.1 First: confirm v1 is landed AND the prerequisite is archived

Check `openspec/changes/archive/` for (a) the archived Phase-5 change — v1 must be landed — and (b) the archived **`universal-decoration-coverage`** change (RFC App. D.28; the v1.x prerequisite that adds the per-file `<file>.intent` sidecar so comment-less files like `package.json` can be decoration-covered). If Phase 5 is not archived, **stop** — Phase 6 is post-v1 by contract. If `universal-decoration-coverage` is not archived, **stop** — without it the POC cannot decoration-cover its own `package.json`/configs and cannot reach the 100%-coverage bar; that change lands first. Do not start the greenfield build against an un-landed v1 or a missing prerequisite.

### 6.2 Scaffold + author the OpenSpec change from the plan brief

Phase 6's artifacts do not exist yet. Run `/openspec-new-change` for `phase-6-greenfield-poc`, then author **proposal → design → specs → tasks** directly from the plan's Phase 6 section (lines 839–923) and the roadmap Sprint 11 framing. The plan section is structured exactly as the four-artifact source material (Outcome → proposal why; Scope → what changes; Behavioral tests + smoke → acceptance; Cohesive landing → definition of done). Capability specs to consider: `greenfield-poc-build` (the application + the dialog-authored tree), `zero-handwritten-audit` (the trailer auditor + transcript checker), `poc-report` (a new `PocReport` sibling schema in `@dusk/core-schema` + its evaluator, modeled on `DogfoodReport`'s two-section gating/exploratory pattern — not a literal reuse), and whatever decomposition the P6-T* tests cleanest into. Validate with `openspec validate phase-6-greenfield-poc --strict` as you go. Add the one-line Post-v1 entry to `openspec/config.yaml`'s phase-order note.

### 6.3 Then: implement via `/openspec-apply-change`

Work the task list top-to-bottom. The natural order: stand up the POC repo + confirm dusk-against-external-repo works → author the intent tree through real dialogs → run the `dusk_implement` requests that build the endpoints (including the multi-bead/file-overlap run and the natural pause→author→resume) → wire + run the full pyramid against live Postgres + real HTTP → build the audit tooling and run it → produce the `PocReport`.

### 6.4 Atomic commits, conventional commits — in BOTH repos

In the dusk repo: conventional commits for the OpenSpec change + tooling, referencing the P6-T slug. In the POC repo: the pipeline-produced commits carry their v9 trailers automatically; your only POC-repo commits outside the pipeline are the initial `dusk init` scaffold (which is config/infra, not application source — keep the line clean and document it in the design so the trailer auditor's "application source" predicate is unambiguous).

### 6.5 If the greenfield load surfaces a dusk runtime defect

Likely, given Phase 5 found six. Handle it exactly as the dogfood did: a tightly-scoped fix in the affected dusk package + a regression test + a living-spec delta if behavior was mis-specified ("archives are history; main specs are the contract" — the Phase-4 board's adopted policy). This is in-scope *support* work, distinct from the Phase-6 deliverable; do not let it balloon into reshaping a capability.

### 6.6 The hardest parts (think before coding)

- **dusk-against-an-external-repo** (§5.2) — de-risk first; everything depends on it.
- **Two orthogonal predicates — do not conflate** (the cohesion seam with the universal-decoration-coverage prerequisite; the plan's Phase-6 thesis-constraint bullet is authoritative):
  - **Coverage axis** (governed by `decoration.ignore`, from the prerequisite): EVERY non-ignored file is decoration-covered — comment-bearing inline, comment-less (`package.json`, configs) via their `<file>.intent` sidecar. The *only* coverage-exempt files are the `decoration.ignore` globs (`node_modules/**`, `.git/**`, `dist/**`, `build/**`, `coverage/**`, `**/*.lock`, `.env*`, …). So configs/manifests are **NOT** coverage-exempt — they carry sidecars and count toward the 100% bar.
  - **Provenance axis** (governed by the trailer auditor): which commits must carry the full v9 trailer set. *Required* (pipeline-produced): all runtime application source **and all test bodies** under the pyramid suffixes (`unit-tests`/`integration-tests`/`e2e-tests`). *Trailer-exempt scaffold* (may be `dusk init`-/hand-authored): the `dusk init` output; the stack-config files; generated migrations; and the **Vitest infrastructure provisioning** (`globalSetup` spinning up Postgres + the e2e app-boot helper). Keep it minimal.
  - A file can be **trailer-exempt yet coverage-required**: `package.json` may be init scaffold (provenance) *and* still carry a sidecar (coverage). Rule each file on **both** axes in the design, enumerated, not improvised. The honest line: the *test bodies* prove P6-T3/T4 were Dusk-produced; the *infra harness* that runs them is scaffold; *all* of it is decoration-covered.
  - **Verify the auditor against reality, not a fixture (the load-bearing lesson from the P0 gate fix):** the gate regression that fired into a crash passed its author's "I saw it block" check because that check drove the internal `{tool,args}` *test* shape, never the real `{hook_event_name, tool_name, tool_input}` wire payload — it "blocked" because it was *crashing*. Mechanical-boundary verification MUST drive the exact production artifact. So: test the trailer auditor against the **real `git log` of an actual pipeline run** in the POC repo, not a synthesized commit shape. An auditor that "passes" on hand-built commit fixtures has the identical blind spot.
- **The full pyramid on live infra** (P6-T3/T4) — the Test Runner is **vitest-only and provisions nothing** (`pnpm vitest run <files>` via `@dusk/runtime-test-runner`). Live Postgres + the booted HTTP surface come from the **POC's own Vitest `globalSetup`** (docker-compose/testcontainers + an app-boot helper), which the runner's invocation honors (worktree Vitest inherits the config + the symlinked `node_modules`). Integration vs real Postgres and e2e vs real HTTP through the pipeline is genuinely new — the Phase-3 machinery only ran on fixtures; expect to exercise the two-stage satisfaction + livelock paths for real, and to need an ambient Postgres reachable from the worktree.
- **Authoring intents that match feasible code** — the Phase-5 dogfood's recurring friction was over-strict intents blocking the long cycle. Author with the implementation's realistic shape in mind; resolve mismatches through re-scoping (whitelisted), never by hand-editing code.

---

## 7. Phases 1–5 status (so you know what you're standing on)

- **Phase 1** (archived): the constraint-language substrate — `@dusk/{test-harness, core-schema, core-parser, core-graph, core-decoration, core-index, pre-tool-use, cli}`.
- **Phase 2** (archived): runtime + read-path verification — `@dusk/runtime-{orchestrator, memory, skills, tool-scope, verifier, verifier-test-double}`, `@dusk/mcp-server` (package name is `@dusk/mcp-server`, at `packages/delivery/mcp-server/`). Verifier runs on the **ambient Claude Code CLI** (no API key).
- **Phase 3** (archived): the full 9-step `dusk_implement` pipeline — 12 `@dusk/runtime-*` packages (recovery ladder, livelock detection, pause/resume, cooperative cancel, worktrees, topological merge, Conflict Resolver).
- **Phase 4** (archived, board-ratified): the 5-stage `dusk_author` dialog — `@dusk/runtime-author` + MCP/CLI surfaces. Closed the `dusk_implement` ↔ `dusk_author` loop.
- **Phase 5** (archived once the window opened): the measurement phase — `@dusk/runtime-observability` (complete trace stream + ring buffer + out-of-band mirrors), `@dusk/runtime-benchmark` (three-axis fresh-Verifier audit with pre-registered frozen bars, the seeded-violations fixture, the dogfood evaluator), `dusk doctor --static-analysis`, the worked-example regression, and ecosystem skeletons in `packages/api` + `packages/web`. **Crucially: it upgraded `dusk implement` to dogfood-grade and proved the whole loop on real `packages/shared` code — the pipeline wrote both a fix and its own passing test.** Phase 6 is the same machinery, pointed at a greenfield repo instead of a brownfield leaf.

**When Phase 6 archives, v1.x has its first milestone landed: the canonical greenfield reference.**

---

## 8. Mindset

You are proving the thesis on the terrain Dusk was designed for. The whole architecture — decorate-at-authorship, total decoration, the gate, per-aspect verification — is cheapest and truest when code is *born* decorated, and Phase 6 is the only test that runs it that way. The constraint that makes this meaningful is also the one that's tempting to break: **zero hand-written application code**. When the pipeline stalls, the answer is always a whitelisted human action — a clearer dialog answer, a re-scoped request, a recovery resolution — never a quiet hand-edit. The trailer auditor will catch a cheat; more importantly, a cheat would make the POC a lie. Born-decorated code showing zero erosion under static analysis (P6-T8) is the single strongest piece of evidence the project can produce for its own central claim. Get it honestly.

And remember the deliverable is twofold: a **working API** (P6-T7 — adherent-but-broken falsifies the thesis too) *and* the **mechanical proof** of how it was built. Both, or neither.

**Build for right. Land the plane. Then prove it flies on a runway it built itself.**

---

## 9. To begin

1. Confirm BOTH are archived under `openspec/changes/archive/`: the Phase-5 change (v1 is landed) AND `universal-decoration-coverage` (the prerequisite — §6.1). If either is missing, stop and say so.
2. Scaffold the change: `/openspec-new-change` → `phase-6-greenfield-poc`. Author proposal → design → specs → tasks from `docs/rfcs/001-mvp-rfc/v9-implementation-plan.md` Phase 6 (lines 839–923) + roadmap Sprint 11. Validate `--strict`. Add the Post-v1 line to `openspec/config.yaml`.
3. Implement: `/openspec-apply-change phase-6-greenfield-poc`. De-risk dusk-against-an-external-repo first; stand up the POC repo; author the tree through real dialogs; build the endpoints through `dusk_implement`; run the full pyramid on live infra; build + run the audit tooling; produce the `PocReport`.
4. Verify the cohesive-landing checklist; `/openspec-archive-change phase-6-greenfield-poc`. The POC repo is then publishable as the canonical greenfield reference, and its friction data prioritizes the rest of v1.x.
