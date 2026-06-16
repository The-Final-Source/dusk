# Handoff — Investigate + resolve D.33 (`error_max_turns` → fatal `dusk implement` crash)

> Paste this whole file as the opening prompt for a **fresh Claude Code session** in the **dusk monorepo**. Your job is the FULL corrective cycle for a live gap (D.33 candidate): **run the multi-agent arch board to investigate from first principles, identify the root cause(s), design the optimal solution, then materialize it (RFC App. D.33 + an OpenSpec change + cohesive RFC weave), re-audit the materialization with the board, implement it, get tests green, and archive.** When it lands, the Phase-6 greenfield POC (paused at the bootstrap-tree layer) resumes. This is the same cycle that produced D.28–D.32; you run it end-to-end this time.

---

## 0. Mission in one paragraph

The resumed Phase-6 POC build crashed: `dusk implement` died with an **uncaught `TransportLegFailure` → exit 1** when a model-client spawn (`claude --print … --max-turns 3`, used by the Verifier / Stage-1 test-body pre-pass / non-Engineer reasoning sub-agents) exited `error_max_turns` (the model spent its turns on tool attempts in a no-tools context), was **misclassified as a transport failure**, cold-retried (reproducing the identical deterministic failure), and — on the second "transport death" — threw fatally past a recovery path that only catches *returned* errors. No bead merged; the whole run died. There are **two independent facets**: **A** — *why* a no-tools JSON call burned its turns on tool attempts; **B** — *why* a deterministic (non-transport) failure is fatal to the run. Your task: convene the arch board (the four-lens panel used for D.28–D.32), investigate both facets from first principles (verify the CERTAIN facts, resolve the INFERRED/open ones empirically), let the board design the optimal corrective (do NOT assume D.26's salvage mechanism transfers), then materialize + re-audit + implement + archive it as the v1.x change `d33-...`. **To begin, read the two source docs in §7, verify the failure chain, then run the board (§4).**

---

## 1. Context — what Dusk is, where we are

Dusk is a constraint-satisfaction system for spec-driven AI development: authors write **intents** (YAML, triples); code is **decorated** with markers linking lines to triples; a **Verifier** judges adherence; a headless **Engineer** (`claude --print`) drafts code in a git worktree under a **short cycle**; a post-hoc **gate** hard-blocks undecorated/uncovered writes. Repo: the **dusk monorepo** (you work here), TS strict ESM, pnpm + Turborepo, Vitest, `@dusk/*` packages.

**Where this sits:** v1 is landed (Phases 1–5). The Phase-6 greenfield POC (a notifications API built through dusk with zero hand-written code) is exercising shipped v1 behavior on its native terrain and surfacing a **series of arch-board-resolved correctives**, each landing as its own v1.x change before the build proceeds: **D.28** (universal-decoration-coverage, the prerequisite), **D.29/D.30/D.31** (the structural verification channel), **D.32** (test-pyramid routing). **D.33 is the next in that series** — and it lives in the model-call *error-handling* path, orthogonal to the D.29–D.32 verification logic. This is the §6.5 "greenfield load surfaces a dusk defect → tightly-scoped corrective" loop operating exactly as designed.

**Delivery discipline:** spec-driven via OpenSpec; correctives are arch-board-resolved then materialized as a change, implemented, and archived. Conventional commits. ALWAYS run `pnpm build`, `pnpm test`, `pnpm typecheck`. Functional-first, Zod = source of truth, named exports, `type` over `interface`, files < 500 lines, colocated `*.test.ts`. Honest over flattering; **no silent behavior** (surface conflicts/failures explicitly) — this rule is central to D.33.

---

## 2. The gap (D.33) — distilled; verify independently

Full detail in the two source docs (§7). CERTAIN = cited/confirmed; INFERRED = open, must be established.

**Symptom (CERTAIN).** `dusk implement` (POC, scoped to `app/bootstrap/response-envelope` + its `unit-tests`) crashed with an uncaught `TransportLegFailure` → exit 1, pre-merge (nothing reached main). Both retry attempts were identical: `claude CLI exited 1: {"subtype":"error_max_turns","num_turns":4,"stop_reason":"tool_use","output_tokens":~1090, <cache reads>}`. Non-zero output + cache reads ⇒ the spawn ran and produced output — **not** a 0-token/no-response blip.

**Which spawn (CERTAIN).** The throw is `runClaude`'s non-zero-exit reject inside `claudeCodeModelClient` (`packages/runtime/verifier/src/modelClient.ts`), which spawns `claude --print … --max-turns 3` (`:140`). That client backs the Verifier, the Stage-1 pre-pass, and non-Engineer reasoning sub-agents (the `taskRunner` ELSE branch). It is **NOT** the Engineer (`runHeadlessAgent`, `cli/src/implement.ts:223`, no `--max-turns`). *(INFERRED: which exact caller — Verifier vs pre-pass vs reasoning — is unpinned; all share the same wrapped client + fatal path, so the gap is path-level.)*

**The failure chain (CERTAIN, cited).**
1. `claudeCodeModelClient` spawns `--print --output-format json --model <m> --max-turns 3 --disallowed-tools [Bash,Edit,Write,Read,Glob,Grep,Task,WebFetch,WebSearch]` + a "You have NO tools available… Never attempt a tool call…" suffix (`modelClient.ts:90` DISABLED_TOOLS; `:138-145`). The code comment states the cap's intent: *"a stray tool ATTEMPT (denied below) must not hard-fail the call with error_max_turns — the model recovers and answers in text."*
2. The model instead spent its turns on tool attempts (`stop_reason:"tool_use"`, `num_turns:4`) and exited `error_max_turns` (non-zero). `runClaude` rejects with `"claude CLI exited 1: …"` (`modelClient.ts` `child.on('close')`).
3. Every `modelClient.complete` is wrapped: `withTransportRetry(() => rawModelClient.complete(req))` (`implement.ts:328`).
4. `isTransportError(err) === true`: `TRANSPORT_MESSAGE_RE = /claude CLI (timed out|exited)/` matches the message (`packages/test-harness/src/transportError.ts:22,24`). The classifier's own doc scopes "transport" to plumbing (timeout / non-zero exit / spawn errno / malformed envelope).
5. `withTransportRetry` cold-retries once; the retry reproduces `error_max_turns` exactly; two transport-classified deaths ⇒ throws `TransportLegFailure` (`packages/runtime/benchmark/src/transportRetry.ts:24-33`).
6. `TransportLegFailure` is **thrown**, not returned. The verifierFactory recovery only re-runs on a *returned* `{error.kind:"verifier_model_call_failed"}` (`implement.ts:421,428`) — it does not catch a thrown `TransportLegFailure`. So it propagates uncaught: `taskRunner → spawnSubAgent → runShortCycle → processBead → runImplement → exit 1`. No salvage, no bead, run dies.

**Two facets (CERTAIN the split; the causes are partly INFERRED).**
- **FACET A — why `error_max_turns` at all.** A single-shot JSON call burned 4 turns on tool attempts despite `--disallowed-tools` + the no-tools instruction. The `--max-turns 3` design assumed ≤1 stray denied attempt then recovery; observed was persistent attempts to the cap. **Open/empirical:** is `DISABLED_TOOLS` complete vs the CLI's actual tool set (a non-listed tool = a genuine, non-denied `tool_use`)? does a *denied* attempt consume a turn (so 3 attempts exhaust the cap)? is it model-/version-specific (`claude-sonnet-4-6`), prompt-shape-specific (the pre-pass embeds full test bodies), or environment-specific (CLI flakiness seen this run — §6 of the source doc)? **None established — investigate.**
- **FACET B — why a deterministic failure is fatal.** `error_max_turns` is a deterministic function of (task + cap) — the identical cold-retry reproduced it — so cold-retry cannot help, yet two deaths make it fatal. The transport model treats *any* non-zero CLI exit as transient plumbing, but a turn-limit exit is **content/limit-shaped, not plumbing.**

---

## 3. The D.26 precedent + the live tension (verified — read this before the board)

D.33 is structurally adjacent to **RFC App. D.26** (`intent-architecture-proposal.md:2852`) — read it in full. D.26 fixed the analogous case on the **Engineer** path (a deterministic wall-clock timeout was transport-misclassified → cold-retried with the identical too-large task → fatal, discarding the correct partial worktree) via **salvage-and-continue** (the spawn *resolves* with a salvage marker; the partial draft is already on disk; the short cycle re-enters). **Crucially, D.26 explicitly:**
- **rejected a `--max-turns` cap for the Engineer** (each iteration is a fresh memory-less spawn; capping turns would force cold re-derivation of the worktree), AND
- **carved out the Verifier's `--max-turns 3` as "the opposite case (bounding *stray* tools in a no-tools, answer-in-text context)"** — i.e. D.26 deliberately *endorsed* the very cap that D.33 now shows can be fatal.

So the board's tension is sharp and must be reasoned from first principles, **not** by assuming D.26 transfers: D.26's salvage works because the Engineer leaves a partial *worktree* to continue from — **a model call has no partial artifact to salvage** (it either returns a verdict or it doesn't). And D.26 *blessed* the `--max-turns 3` that Facet A implicates. The board must decide whether D.33's fix is on Facet B (the fatal-classification/handling of a deterministic model-call failure), Facet A (eliminate the `error_max_turns` at the source), or both — and how, given the model-call path's different shape.

---

## 4. How to run the arch board (the methodology — this is the core of your job)

Run the same investigate→debate→converge board that produced D.28–D.32. Operate it as the **synthesizing orchestrator**: you spawn independent reviewer sub-agents, collect their findings, synthesize a board verdict, and iterate to convergence; you (not the sub-agents) make the call and do the materializing/implementing.

**Phase I — Investigate (verify CERTAIN, resolve INFERRED).** First, independently verify the failure chain (§2) against the live code at the cited file:lines — do not take the gap report on faith. Then resolve the open Facet-A empirical questions (§2): inspect the CLI's actual tool set vs `DISABLED_TOOLS`; determine whether a denied tool attempt consumes a turn; check whether the pre-pass prompt shape (full test bodies) or the model/version is implicated; weigh the §6 environment-flakiness confound. Use read-only Explore/general-purpose sub-agents for breadth where useful. Produce a **verified facts** brief separating what's now CERTAIN from what remains genuinely uncertain (and whether the uncertainty even matters to the fix).

**Phase II — Board design (first principles).** Spawn the **four-lens panel in parallel**, each read-only, each with the verified facts + the design space (§5) + the D.26 tension (§3):
- **Lead Architect** — where does the corrective belong; what is the principled contract for "a deterministic, content/limit-shaped model-call failure" vs "transport plumbing noise"; consistency with D.26 and the transport model; one-source-of-truth for failure classification.
- **Lead Backend Engineer** — fidelity to the code + buildability of each candidate (narrow `isTransportError`; return-vs-throw at the leg; catch the throw in the verifierFactory; Facet-A tool-suppression options); the exact touch-points; what each fixes and does NOT fix alone.
- **Lead AI Engineer** — the model-behavior facet: why a no-tools call attempts tools; the right way to make `tool_use` impossible (allow-list of zero tools vs disallow-list completeness vs prompt hardening vs cap change); determinism posture (which fixes are zero-model mechanical vs model-facing); whether a model-call failure should become a verdict-level signal the short cycle handles.
- **Martin Fowler** — simplicity/honesty: is the root that a *deterministic content-limit failure is being cold-retried as transient plumbing* (the D.26 lesson, un-applied to this path)? what is the minimal honest fix; reject pile-on; ensure "no silent behavior" is upheld (the failure must surface, not be swallowed or fatally crash); name what's symptom vs root.

Each returns findings + a verdict (APPROVE / APPROVE-WITH-CHANGES / REJECT) + the single most important issue. **Synthesize** a board verdict with a deduplicated, prioritized action list; if reviewers diverge on a real fork (e.g. Facet-A-too vs Facet-B-only), resolve it explicitly with reasons. Iterate (another round) only if a genuine open question remains — watch for negative returns (Fowler will tell you when to declare convergence).

**Phase III — Materialize.** Author **RFC App. D.33** (in the D.26/D.29–D.32 series) + scaffold the OpenSpec change (`openspec new change`, e.g. `model-call-failure-handling` or similar) and author proposal/design/specs/tasks **from the converged board verdict** — exactly as D.32 was done. Then cohesively update every affected RFC surface (App. D.33; the transport/retry framing; any §7 observability or §9 sub-agent sections; the v1.x sequencing in roadmap + plan — D.33 joins the corrective series). Validate `openspec validate <change> --strict`.

**Phase IV — Materialization re-audit.** Re-run the four-lens board on the *authored* artifacts + RFC weave: verify fidelity to the converged design, cohesion across the docs, and a fresh adversarial pass (did the authoring introduce a defect; is anything tested nowhere; counts/refs accurate). Fold in the findings; converge.

**Phase V — Implement.** Apply the code fix per the tasks, with colocated zero-model tests for the mechanical guards (and the reproduction in §8 as regression tests). `pnpm build`/`typecheck`/`test` green. Check the tasks; `openspec validate --strict`; **archive** the change (sync specs).

**Phase VI — Hand back.** Provide a short resume note for the Phase-6 POC session (analogous to `phase-6-resume-after-d32.md`): D.33 landed, point the POC at the freshly-built dusk, resume from the bootstrap-tree layer.

---

## 5. Design space (OPTIONS for the board — not a decision)

The gap report frames these; the board decides which facet(s) and how, from first principles.
- **Facet B (handling):** narrow `isTransportError` so a turn-limit/limit-shaped exit (`error_max_turns`, or `is_error` result subtypes) is NOT classified transport (don't cold-retry a deterministic failure); OR convert a model-call failure into a **returned** verdict-level failure the short cycle handles (re-draft/diagnose) instead of an uncaught throw; OR make the leg non-fatal (a salvage analog — but note a model call has no partial artifact, unlike D.26's Engineer worktree); OR catch the thrown `TransportLegFailure` at the verifierFactory and route it like a returned `verifier_model_call_failed`.
- **Facet A (source):** raise/remove the cap for these calls (but D.26 endorsed the cap to bound stray tools — reconcile); complete the `--disallowed-tools` set / use a zero-tool **allow-list** so no `tool_use` is even attempted; harden the no-tools instruction; detect tool-attempt loops early.
- **Do NOT assume the D.26 salvage mechanism transfers unchanged** (different path shape). Decide whether B alone suffices (make the deterministic failure non-fatal + legible) or A is also needed (stop producing `error_max_turns`), and whether the two are independent fixes.

---

## 6. Constraints / guardrails

- **Tightly-scoped dusk-repo corrective** — a model-call error-handling fix (+ possibly a tool-suppression fix), in the D.11/§6.5 "scoped fix + regression test + living-spec delta" mold. Not a reshaping of the verification logic (orthogonal to D.29–D.32).
- **No silent behavior** — whatever the fix, a genuine model-call failure must be **surfaced** (a returned/handled signal or a legible loud failure that the short cycle / recovery ladder can act on), never swallowed into a false pass and never an uncaught fatal crash. This is the honesty bar.
- **Mechanical guards are zero-model + tested** (classification, return-vs-throw, catch path). Model-facing pieces (tool suppression, prompt) are rate-improvers, not correctness guarantees — frame them as such; don't let a correctness claim rest on model behavior.
- **Determinism + transport posture** are established (`temperature:0`; the transport-failure amendment from the Phase-4 board / D.26). Your fix refines *what counts as transport* and *what is fatal* — keep that posture coherent, and reconcile explicitly with D.26's endorsement of `--max-turns 3`.
- **Do NOT touch the POC repo or the Phase-6 change.** The corrective is dusk-side; the POC resumes after it lands (Phase VI).

---

## 7. Source-of-truth references (read first)

- **The gap report** (the "Arch-Board Input" you were handed) + its neutral companion: `docs/rfcs/001-mvp-rfc/error-max-turns-fatal-crash-handoff.md`. The full crash output + the preserved evidence (crashed worktree `bd_20260616142011006`, branch tip `70dadf6`, `.ia/observability/traces.jsonl`) are referenced there.
- **Evidence map (verify each):** `packages/runtime/benchmark/src/transportRetry.ts:24-33` (`withTransportRetry`, `TransportLegFailure`); `packages/test-harness/src/transportError.ts:22,24` (`TRANSPORT_MESSAGE_RE`, `isTransportError`); `packages/runtime/verifier/src/modelClient.ts:90,138-145` (`DISABLED_TOOLS`, `--max-turns 3`, the design-intent comment, `runClaude` reject); `packages/cli/src/implement.ts:328` (model-client wrapped in `withTransportRetry`), `:223` (Engineer args — no `--max-turns`), `:374` (Engineer salvage-on-timeout, D.26), `:369-379` (taskRunner: `dusk-engineer`→`runHeadlessAgent` vs ELSE→`modelClient.complete`), `:421,428` (verifierFactory returned-error retry that does NOT catch a thrown `TransportLegFailure`).
- **RFC `docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md`** — **App. D.26** (the analogous Engineer wall-clock case + salvage resolution + the explicit `--max-turns` rationale — read in full); App. **D.29–D.32** (the corrective series D.33 joins); App. D tail (D.33 goes after D.32, before "Items genuinely still open").
- **Templates for the cycle you'll run:** `docs/rfcs/001-mvp-rfc/test-pyramid-routing-handoff.md` and the archived `openspec/changes/archive/2026-06-16-test-pyramid-routing/` (proposal/design/specs/tasks shape + how the RFC weave + handoff were done for D.32 — mirror it).
- **`CLAUDE.md`** (repo root) — conventions. **OpenSpec skills:** `/openspec-new-change`, `/openspec-apply-change`, `/openspec-archive-change`.

---

## 8. Reproduction (turn these into regression tests)

- **Facet B (unit, zero-model):** `isTransportError(new Error('claude CLI exited 1: {"subtype":"error_max_turns",…}')) === true` today; `withTransportRetry(observe)` where `observe` rejects twice with that error throws `TransportLegFailure` (fatal). The fix must change one or both so a deterministic `error_max_turns` is not cold-retried-to-fatal and is handled/surfaced.
- **Facet A (e2e, model-equipped env):** run a Verifier / Stage-1 pre-pass completion in an environment where the model attempts a (disallowed) tool; observe whether it exhausts `--max-turns 3` → `error_max_turns`.

---

## 9. Definition of done

- The arch board has investigated (CERTAIN verified, INFERRED resolved or shown immaterial) and converged on a first-principles solution (verdict recorded, e.g. in the change's design "Review round"), with the D.26 tension explicitly reconciled.
- RFC **App. D.33** authored in the corrective series; the OpenSpec change scaffolded, authored, `--strict`-valid, and cohesively woven across the RFC docs (App. D, transport/retry framing, roadmap/plan v1.x sequencing).
- Materialization re-audited by the board; findings folded in.
- The fix **implemented**: a deterministic/content-limit model-call failure is never silently accepted and never an uncaught fatal crash — it is surfaced/handled (per the board's chosen mechanism); Facet A addressed if the board so decides. Reproductions (§8) are regression tests; mechanical guards zero-model.
- `pnpm build`/`typecheck`/`test` green; change **archived** (specs synced).
- A Phase-6 resume note handed back (Phase VI). POC repo + Phase-6 change untouched.

---

## 10. To begin

1. Read §7's two source docs + RFC App. D.26 and D.29–D.32.
2. Verify the §2 failure chain against the cited code (don't trust the report).
3. Resolve the Facet-A open empirical questions (§4 Phase I).
4. Run the four-lens board (§4 Phase II) → converge on the design.
5. Materialize (D.33 + OpenSpec change + RFC weave) → re-audit (Phase IV) → implement (Phase V) → archive.
6. Hand back a Phase-6 resume note (Phase VI).

**Investigate from first principles. Let the board decide both facets. No silent behavior, no fatal crash on a deterministic failure. Then hand back.**
