## Context

Phase 3 is the largest phase and carries the most board-hardened control machinery in the v9 architecture. Phase 1 shipped deterministic substrate; Phase 2 shipped the model-in-the-loop verification path. Phase 3 wires the full 9-step `dusk_implement` pipeline — request decomposition → bead DAG with overlap detection → worktrees → short cycle (with stuckness detector + iter-5 fallback + iter-15 escalation + 40-iter lifetime budget + the FULL 4-level recovery ladder) → long cycle (N=10 + N=2 confirmation pass) → test execution (two-stage satisfaction + livelock detection) → atomic commit → topological merge → return summary. Plus pause/resume via disk checkpoint and `dusk_cancel` cooperative cancellation.

Several round-4 board fixes are load-bearing here. The full 4-level Recovery Ladder lives in Phase 3 (not split to Phase 5) — splitting it produced a semantic contradiction where a zero-satisfiable bead would hard-abort (`recoverable:false`) when the RFC says it should emit `bead_intent_revision_needed` (`recoverable:true`). The checkpoint JSON shape is **frozen as a cross-proposal interface** because Phase 4 *consumes* it — Phase 3 must pin every field even when it ships only naive content for some (`suggested_dialog_seed`). Confirmation-pass dismissal (P3-T15) is tested via the scripted-verdict double because a real frontier model can't be made to reliably reject-then-accept-twice on demand — the *orchestration* is the unit under test, not the model.

The Decomposer is the largest single piece of new logic (typed-`relates_to` walking + file-overlap edge construction + cross-bead focal/support overlap precondition + checkpoint write on unresolved-intent). Step-4 short cycle is the second largest (Engineer↔Verifier loop with stuckness detection, the 4-level recovery ladder, gate-fail loopback, the `support_quality` no-redraft loop consequence). Both must hold a stable interface to Phase 4 (which replaces the Decomposer's unresolved-intent stub with a real Author flow) and Phase 5 (which measures everything Phase 3 produces).

## Goals / Non-Goals

**Goals:**

- Define the session-snapshot index read model that lets parallel beads reason against a single immutable base while a bead sees its own in-flight delta.
- Define the bead DAG construction algorithm — typed-`relates_to` walking + file-overlap serialization edges + cross-bead claim-overlap precondition (focal=hard refusal, support=warning).
- Define the deterministic 4-level Recovery Ladder transition function with the corrected trigger semantics (L4 fires ONLY on freeze-serialization failure, not on "nothing satisfiable").
- Define the checkpoint JSON shape + lifecycle as the frozen cross-proposal interface Phase 4 consumes.
- Define the N=10 long-cycle with the N=2 confirmation-pass topology and the asymmetry between "confirmed reject" (re-enter Step 4) and "flaky verdict dismissed" (continue sampling).
- Define the two-stage test satisfaction flow (Verifier pre-pass → Vitest invocation) and the livelock-vs-budget precedence.
- Define `dusk_cancel` cooperative drain semantics honestly (no Task abort exists; flag-and-drain is the only correct model).
- Define Step-8 rebase's `Partial: true`-aware drift detection.
- Pin all Phase-3 cross-change interface seams that Phase 4 + Phase 5 will bind to.

**Non-Goals:**

- Author 5-stage dialog flow, Stage 4.5 validations, dialog persistence. **L2's recovery *action* (`dusk_author_continue` consumption of `intent-proposal.yaml`) is Phase 4.** L2's *artifact* (the yaml file + the recoverable `bead_intent_revision_needed` error) ships here.
- Fresh-Verifier audit, `/dusk-doctor --static-analysis`, observability sinks, benchmark harness, seeded-violations fixture, dogfooding. Phase 5.
- App-package code — untouched.
- Re-deriving any Phase-1 or Phase-2 capability. Phase 3 binds to those interfaces without reshaping them.

## Decisions

### D1 — Session-snapshot index: layered query over an immutable base

At pipeline entry the Root Orchestrator builds the session snapshot by querying the Phase-1 derived-index against the merge-base commit (`origin/main` by default; `--rebuild-index` forces re-derivation within an existing session). The snapshot is **frozen for the run's lifetime**, identified by `index_snapshot_id = sha256(merge_base_commit + index_serialization)`. Every `SubAgentTrace` emitted during the run carries this id (Phase 2 reserved the field; Phase 3 sets it).

Per-bead **deltas** are in-process objects (not files): a `BeadDelta` records decoration writes the bead's Engineer has performed in its worktree but not yet merged. A bead's own Verifier sees `snapshotQuery ∪ beadDelta`; cross-bead queries (Decomposer file-overlap, long-cycle universe, focal/support claim-overlap precondition) see the snapshot only. This preserves the Phase-1 D6 contract — the *query interface* is unchanged; Phase 3 swaps the *backing store* to the layered model.

**Alternative considered:** persist deltas to disk so cross-bead queries can opt-in. Rejected — round-3 board's session-snapshot decision is specifically to keep cross-bead queries deterministic against the merge-base; opt-in delta visibility breaks the same-base invariant P3-T1 asserts.

### D2 — Bead DAG construction: three orthogonal edge sources, conflict detection before worktrees

The Decomposer outputs a single DAG combining edges from three orthogonal sources:

1. **Typed `relates_to` edges** — derived from the intent set per RFC §6.2: `implies`→auto-add the target to the active set + edge from this bead to the implied; `conflicts`→**no DAG issued**, return `decomposer_bead_conflict` (hard refusal); `supersedes`→exclude target from the active set; `parent`/path→scope-expansion edge (descendant→ancestor); `sibling`→context-only, **no auto-expand**.
2. **File-overlap serialization edges** — for each pair of beads, predict claimants via the snapshot (intent path + descendants → claimant files); if the predicted file sets overlap, add a serialization edge. Cross-cutting intents commonly trigger these.
3. **Cross-bead claim-overlap precondition** — focal-claim overlap on the same `(intent_path, aspect_id)` → HARD refusal (`decomposer_bead_conflict`); support-claim overlap on the same region → advisory warning surfaced in the run summary (non-blocking).

**All three are computed at DAG-build time, before any worktree exists.** A failing precondition aborts before disk state is created. This is the only correct ordering — once worktrees exist, an aborting refusal would orphan them.

**Alternative considered:** detect conflicts lazily at merge time. Rejected — by then, work has been done in worktrees and the orchestration has spent tokens. Hard refusal upfront preserves the "honest, no silent behavior" stance.

### D3 — Recovery Ladder: deterministic decision tree over satisfaction state at exhaustion

The ladder is a **pure decision function** invoked when the 40-iter lifetime budget exhausts. Inputs: `(satisfaction_state, partial_commit_valid, freeze_writable)`. The transitions are deterministic and tested per level via its own forcing fixture:

```
exhaustion_state →
  L1 if (≥1 intent satisfied) ∧ partial_commit_valid
  L2 if (¬L1) ∧ proposal_generation_succeeds
  L3 if (¬L2) ∧ freeze_writable
  L4 otherwise
```

This is the round-4 fix. The round-3 cascade was `L1 → L2 → L3 → L4 with L4 = "nothing satisfiable"` — which contradicted RFC §6.4.1 (L4's actual trigger is *"L3 cannot serialize freeze state"*). Restoring the correct trigger means: a zero-satisfiable bead emits `bead_intent_revision_needed` (`recoverable:true`, L2) rather than `bead_aborted` (`recoverable:false`, L4). The user can fix intents and resume. Hard abort is reserved for genuine system failure (disk error on freeze write).

L2's *recovery action* (`dusk_author_continue` consuming `intent-proposal.yaml`) is Phase 4. L2's *artifact + error contract* (the yaml write + the `bead_intent_revision_needed` error) is fully here, with the `recovery_hint` pointing at `dusk_author_continue` as the documented next step.

**Alternative considered:** ship only L1 + L4 in Phase 3 and defer L2/L3 to Phase 5. Rejected — that's exactly the round-3 mistake that produced the contradiction. The ladder is one machine; you can't ship half of it.

### D4 — Checkpoint JSON shape is a frozen cross-proposal interface in `@dusk/core-schema`

The implement-checkpoint shape lives in `@dusk/core-schema` so Phase 4 imports it directly:

```typescript
type ImplementCheckpoint = {
  schema_version: 1;
  original_request: string;
  scope_hint?: string[];
  decomposer_partial_state: DecomposerPartialState;
  intents_resolved_so_far: string[];
  intents_still_unresolved: string[];
  suggested_dialog_seed: string;        // Phase 3: naive (unresolved_refs.join(", "))
  unresolved_refs: string[];
  created_at: string;                    // ISO 8601 (Clock-injected)
  last_touched_at: string;
};
```

Phase 3 ships `suggested_dialog_seed` as the naive `unresolved_refs.join(", ")` — typed-correct, content-naive. Phase 4 swaps the *content* (enriching with Author-flow framing) without changing the *shape*. Path: `.ia/runtime/implement/<resume_token>.json`. Lifecycle: created at unresolved-intent escalation; deleted on successful Step-1 transition (single-use); 24h TTL with `dusk doctor --gc-implement-checkpoints`. `implement_resume_token_expired` errors preserve `original_request` in `recovery_hint`.

`resume_token` format: `rt_<14-digit-yyyymmddhhmmss><3-digit-seq>` (Phase 1 D8 id convention).

**Alternative considered:** ship checkpoint shape in `packages/runtime/implement-checkpoint` and re-export from `core-schema`. Rejected — Phase 4's Author package would then depend on a runtime package, inverting the dependency graph. Schema-in-core-schema is the only acyclic placement (the same lesson Phase 2 learned with `SubAgentTrace`/`Verdict`/`VerifierFactory`).

### D5 — Confirmation-pass topology: branch-on-first-reject, three-way trace correlation

The N=10 long-cycle sampling proceeds linearly. **Only on the first `reject` in a round set** does the confirmation pass fire: the Bead Orchestrator spawns N=2 additional fresh Verifiers against the **same** `(intent_path, claimant)` tuple. All three share `confirmation_of_trace_id` for post-hoc correlation. Aggregation rules:

- ≥1 of 2 confirmations reject → `confirmation_pass_outcome: "confirmed_reject"` → emit regression report → re-enter Step 4 with the regressed intent added to the active set.
- Both override to accept → `confirmation_pass_outcome: "flaky_verdict_dismissed"` → record on the original trace → continue sampling the remaining rounds.

Subsequent rejects in the same round set do NOT fire another confirmation pass (cost-bounded; the round set is already deemed flaky-prone). All three calls go through `spawnSubAgent({verifierFactory?})` so the Phase-2 scripted-verdict double's `spawnCount` is the structural assertion surface for P3-T14/T15.

**Alternative considered:** confirmation on every reject. Rejected — round-3 board explicitly bounded this. The dismissal-rate signal feeds Phase 5's fresh-Verifier audit; over-confirmation would distort it.

### D6 — Stuckness detector: pure predicate over the last-3 trace events, fires at iter 3

The detector runs after each Step-4 iteration. Predicate inputs are the last 3 `SubAgentTrace` events (Bead-Orchestrator scope) for this bead in this Step-4 entry:

```
stuckness_fired_at(K) iff
  K ≥ 3 AND
  ∀ i ∈ {K-2, K-1, K}: trace[i].verdict_delta_from_prior == ∅ AND
  ∀ i ∈ {K-2, K-1, K}: trace[i].failing_triple_set == trace[K].failing_triple_set
```

On match, the Engineer is forced to write `## Current diagnosis` to bead memory before the next iteration's draft. Diagnosis writes to **bead memory only** — Phase 2's `memory: none` materializer structurally renders the empty block for the Verifier regardless of bead state. The asymmetry-no-leak invariant (no diagnosis text in any Verifier `raw_prompt`) is mechanically checked in-run.

**Iter-5 fallback:** if stuckness hasn't fired by iter 5, the diagnosis is written unconditionally. **Iter-15 early escalation:** if convergence hasn't occurred by iter 15, the bead-memory diagnosis surfaces to the user/harness as the escalation payload (read from memory, not from Verifier-visible state).

P3-T8 has two legs: (a) the **scripted-verdict double** drives iters 3–5 with deterministically identical `failing_triple_set` to prove the detector fires; (b) an **integration leg** derives `failing_triple_set` from real (temp-0) Verifier verdicts on a genuinely-stalling fixture to prove the upstream derivation is wired, not just the predicate. Round-4 board mandated this second leg.

**Alternative considered:** sliding window of size 5. Rejected — adds latency; the 3-iter window is what catches *early* stuckness, which is the entire point.

### D7 — Livelock-vs-budget precedence: livelock wins (richer payload)

When a bead simultaneously exhausts its 40-iter lifetime budget AND meets the livelock detector's 3-condition trigger (same `(test_intent, triple)` rejected ≥3 iters + slot-focus ≥80% concentration + ≥3 distinct taxonomy approaches), **livelock takes precedence**. The decision happens in the orchestrator's tick, not in the recovery ladder.

Mechanism: the orchestrator evaluates livelock detector first; if it fires, emit `TestVerifierLivelockReport` and pause the bead. If it doesn't, evaluate budget exhaustion → ladder. P3-T28 forces both to fire on the same iteration via a fixture configured so the lifetime budget exhausts on the iteration livelock would fire; assertion is that the report is produced (not the generic exhaustion error) and the user resolves via `dusk_resolve_livelock` before iteration would resume.

**Rationale:** the livelock report carries `failing_triple`, slot-focus distribution, and three suggested resolutions — strictly richer signal than the ladder's exhaustion error. Resolving livelock first lets the user decide whether iteration should resume at all.

### D8 — Test Runner Vitest invocation: scoped file list, real fs, real Vitest

Test Runner role (Phase-2 role file shipped; runtime here) spawns a real Vitest subprocess via `pnpm vitest run <scoped-file-list> --reporter=json`. The reporter output is parsed to capture per-test pass/fail/duration. Each captured test maps back to its `(test_intent, triple_id)` via the file's `@intent-test-file` + per-test `@intent-test` decorators (Phase 1's decoration parser).

The Verifier pre-pass (two-stage satisfaction) runs **before** Vitest is invoked. Tests that fail the Verifier check are excluded from the scoped list — they never run. This is what makes "trivially-passing test rejected before it runs" (P3-T16) mechanical: the file never reaches Vitest's hands.

`TestVerdict` per RFC App. A.5 aggregates per-test results into per-test-intent verdicts. `covers-X` triple satisfied iff ≥1 captured test mapped to that triple passes.

**Alternative considered:** dynamic Vitest API (in-process). Rejected — subprocess invocation is what real users will hit; testing against the real subprocess is Khorikov-correct.

### D9 — `dusk_cancel` cooperative drain: flag + return; no Task abort exists

Claude Code's Task tool has no documented abort primitive. `dusk_cancel` therefore cannot terminate in-flight Task calls; the implementation is honest about this:

1. Set a per-bead (or session-wide if `bead_id` omitted) cancellation flag.
2. Orchestrator's next tick reads the flag *after* the current Task call returns.
3. **No new Task calls** are issued for the flagged bead(s).
4. Drain: wait for all in-flight Task calls to return naturally; count them as `in_flight_tasks_drained`.
5. Ordered cleanup: dialogs → checkpoints → bead memory → worktrees with no commits.
6. Worktrees **with** commits are preserved as `partial_commits[]` for user decision (the branch stays; the user decides whether to merge or discard).
7. Already-merged work is preserved as `already_committed[]` (informational).
8. Return `CancelResult` with the cancelled/preserved partitioning.

`cancellation_already_committed` (informational, not an error) fires when `dusk_cancel` is called with a `bead_id` that's already merged to main — honest "nothing to do here" signal.

**Alternative considered:** spin-loop polling with a hard timeout. Rejected — overrides the "Task call runs to completion" semantics of the harness. Drain semantics match what's actually possible.

### D10 — Commit-trailer assembly: one ordered map with conditional sections

Step 7 assembles the commit message from one ordered map merged from five inputs: `(intent_set, test_verdicts, run_metadata, ladder_state, livelock_resolutions)`. Trailer order is fixed (matches RFC App. A.7):

```
Intent: <intent-path> [<aspect-ids>]              (one per touched intent)
Test-Intent: <test-intent-path>                   (one per executed test-pyramid intent)
Bead-id: bd_...
Verdict-id: vd_...
Test-Verdict-id: tv_...                           (when tests ran)
Trace-id: tr_...
Verifier-model: <model-id>
Test-Runner-model: <model-id>
Long-cycle-samples: 10                            (or fewer if universe exhausted)
Test-Suites-passed: <n>
Partial: true                                     (only when Recovery Ladder L1 fired)
Deferred-Intent: <intent-path>                    (one per deferred intent, only with Partial: true)
Verifier-bypassed-test-intent: <test-intent>[<triple-id>]   (only when livelock resolved via accept_test_as_is)
```

Conditional trailers (`Partial`, `Deferred-Intent`, `Verifier-bypassed-test-intent`) appear ONLY when produced via their gated paths. Step 8 rebase logic detects them; Phase 5's audit reads them.

### D11 — Step-8 rebase with `Partial: true`-aware drift detection

Step 8 walks the bead DAG topologically and rebases each branch onto main. For each rebase, snapshot-drift detection compares main's decoration set against (session-snapshot + this branch's expected additions). A drift event would normally fire if main has new decorations the snapshot doesn't know about.

When a commit carries `Partial: true`, the deferred-intent additions are added to the *expected additions* set so they don't trigger a drift warning. This is what makes Variant B of the smoke test (L1 partial commit + clean merge) green: the deferred intent's decorations are the bead's own work, expected by the merge.

**Conflict Resolver** invokes a decorator-aware merge on real rebase conflicts: prefer the side with more aspect ids declared or the more granular path; equal-specificity ties become TODOs in the diff (the round-3 board's "honest about merge ambiguity" stance).

### D12 — Per-entry vs lifetime budgets: relationship, not literals

Tests assert the *relationship* (`lifetime > per-entry`), not the constants 20/40. Both are config-driven via `sanity.short_cycle_max_iterations` and `sanity.bead_lifetime_iterations` in `dusk.config.yml`. P3-T25 uses small fixture values (e.g., 4 and 6) to exercise the cross-entry counter mechanics — the per-entry counter resets at each Step-4 entry; the lifetime counter persists across re-entries (long-cycle bounce, test bounce, livelock resolution loops).

**Round-4 board rationale:** dogfooding will revise the 20/40 literals based on observed convergence rates; parameterizing the tests off literals avoids churn when those tune.

### D13 — Smoke test as a four-scenario set, not a single happy path

The phase-landing smoke isn't one e2e — it's four scenarios that together prove the control machinery:

- **Primary** — request → DAG with file-overlap edge → short cycle converges (stuckness idle) → long cycle N=10 clean → tests verify+pass → one commit per bead with full trailers. Asserts: every trace shares one `index_snapshot_id`; no Verifier `raw_prompt` carries iteration-specific content (the in-run asymmetry check).
- **Variant A** — unauthored intent → `implement_paused_for_authoring`; author out-of-band; `dusk_implement({resume_token})` completes; checkpoint deleted.
- **Variant B** — two-intent bead, one satisfiable → L1 partial commit merges cleanly; second run with zero satisfiable → L2 `bead_intent_revision_needed` + `intent-proposal.yaml`.
- **Variant C** — mid-run `dusk_cancel` → `CancelResult` with correct cancelled/preserved partitioning.

All four must go green for the phase to land. Variant B specifically covers the round-4 corrected ladder semantics (zero-satisfiable → L2 recoverable, NOT L4 hard-abort).

### D14 — Cross-change interface seams pinned by Phase 3

The contracts Phase 4 + Phase 5 bind to (all live in `@dusk/core-schema` for the same acyclic-graph reasons Phase 2 used):

- **`ImplementCheckpoint`** — checkpoint JSON shape (D4). Phase 4 imports + populates `suggested_dialog_seed` with enriched content.
- **`CancelResult`** — `{cancelled: {cancelled_worktrees[], partial_commits[], cancelled_dialogs[], cancelled_checkpoints[], bead_memories_deleted[]}, preserved: {already_committed[], in_flight_tasks_drained}, trace_id, drain_duration_ms}` per RFC App. A.11.
- **`TestVerifierLivelockReport`** — `{bead_id, test_intent_path, failing_triple_id, failing_triple, iterations_rejected, engineer_attempts[], verifier_persistent_rationale, suggested_resolutions[]}` per RFC §3.4.1.
- **`TestVerdict`** — `{test_intent_path, decision, per_triple[], mapped_tests[], rationale, duration}` per RFC App. A.5.
- **Recovery-ladder DuskError kinds** added to the envelope: `bead_intent_revision_needed`, `bead_frozen`, `bead_aborted` (Phase 2 pinned `implement_paused_for_authoring`, `implement_resume_token_expired`, `cancellation_already_committed`; Phase 3 adds the ladder triplet).
- **`DecomposerPartialState`** — opaque-to-Phase-4 serializable state inside the checkpoint; Phase 3 owns its shape; Phase 4 round-trips it verbatim.
- **`CommitTrailers`** — the full v9 trailer set (D10) as a typed structure; Phase 5's audit reads it.
- **Bead-lifecycle event names** on `SubAgentTrace`: `stuckness_detector_state`, `verifier_livelock_signal`, `confirmation_of_trace_id`, `confirmation_pass_outcome` (Phase 2 reserved these fields; Phase 3 populates them).

## Risks / Trade-offs

- **[Decomposer file-overlap prediction has false positives]** — predicting claimant files via the snapshot is approximate; cross-cutting intents whose claimants don't actually overlap might still get serialized. **Mitigation:** advisory `Long-cycle-samples` trailer surfaces serialization events; Phase 5 dogfooding will tune the prediction.
- **[Stuckness detector false positives]** — a genuinely-progressing iteration with coincidentally-stable `failing_triple_set` would force an unnecessary diagnosis. **Mitigation:** the 3-iter window + the empty-`verdict_delta_from_prior` requirement together make this rare; diagnosis is harmless (Engineer can ignore it on next draft); P3-T8 derivation leg ensures the upstream signal is real.
- **[Confirmation-pass cost amplification]** — every first reject burns 2 extra Verifier calls. **Mitigation:** first-reject-only (D5) bounds the worst case to N=12 instead of N=30 for a flaky-prone round set.
- **[Recovery Ladder L2 proposal quality]** — Phase 3 ships `intent-proposal.yaml` with naive content (the diagnosis history aggregated mechanically). The actual recovery-by-Author flow lands in Phase 4. **Mitigation:** the L2 yaml shape is frozen here so Phase 4 type-checks against it; bad proposals don't break the contract.
- **[Cancel during Step 7 commit]** — if cancel fires mid-commit-write, git is left in inconsistent state. **Mitigation:** D9 specifies "allow current Task to finish" — Step-7 commit completes; Step-8 merge is skipped. Open Q3 below resolves this explicitly.
- **[Checkpoint shape lock-in]** — freezing `ImplementCheckpoint` in `@dusk/core-schema` means Phase 4 cannot reshape it. **Mitigation:** the field set comes directly from RFC §10.1.1; any shape evolution becomes a new schema_version with a migration loader (the same pattern Phase 1 used for Intent v8→v9).
- **[Verifier `raw_prompt` no-leak asserted in-run]** — running the assertion on every iteration adds work to the orchestrator. **Mitigation:** test-mode only; production mode emits no `raw_prompt` and runs no assertion. The cost is paid only in tests.

## Migration Plan

Phase 2 is archived; its 5 ADDED + 1 MODIFIED capability specs are in `openspec/specs/`. Phase 3 lands as a single change with no production-data migration: nothing in `.ia/runtime/{beads,implement,session,dialogs}/` is in use yet; `dusk.config.yml` carries the needed keys (`sanity.short_cycle_max_iterations`, `sanity.bead_lifetime_iterations`, `sanity.long_cycle_round_count`, `sanity.stuckness_detector_window`, `models.default`/`models.overrides`); no Drizzle migrations (no Postgres state in Phase 3); rollback = `git revert` of the merge commit.

The existing CLI commands (`dusk init`/`validate`/`inspect`/`verify`/`roles`/`skills`/`doctor`) are extended, not modified; existing MCP tools (`dusk_status`/`dusk_inspect`/`dusk_verify` + paired list/get) gain populated data when `dusk_implement` has been run.

## Open Questions

- **Q1 — Vitest invocation: workspace root vs package directory?** Phase 3 invokes `pnpm vitest run <scoped-files> --reporter=json` from the workspace root with absolute paths in the scoped list. **Resolution:** workspace root. Rationale: Vitest's workspace config is the source of truth for test config (pool, environment, setup files); running from a package would lose workspace-level settings.
- **Q2 — Worktree base: `origin/main` or session-snapshot tag?** Worktrees are created off `origin/main` (the same base the snapshot was derived from), not a tagged snapshot. **Resolution:** `origin/main`. Rationale: keeps the worktree creation deterministic against the same commit the snapshot encoded; if `origin/main` advances mid-run, the snapshot is now stale and `--rebuild-index` is the correct response — not a tagged worktree that hides the staleness.
- **Q3 — `dusk_cancel` during Step 7 commit?** Cancel sets the flag; if Step 7 is in-flight, the commit completes and lands on the bead's branch; Step 8 is skipped. The commit then appears in `CancelResult.partial_commits[]` for user decision. **Resolution:** allow commit; skip merge. Rationale: the commit is on a branch (not main), so it's recoverable; aborting mid-write would leave a corrupted git state.
- **Q4 — `dusk_resolve_livelock({verb: "modify_triple"})` interaction with the Decomposer pause?** When the user selects `modify_triple`, the bead pauses (livelock report payload). The user then edits the test-intent triple out-of-band and invokes a follow-up MCP call. **In Phase 3, this is `dusk_resolve_livelock({verb: "modify_triple", payload: {edited_triple}})`** — the call carries the edited triple inline; Phase 4 will rewire this to a `dusk_author_continue` flow once the dialog continuation pattern exists. **Resolution:** inline payload in Phase 3; refactored to author-dialog in Phase 4. The bead resumes from the failing iteration with the refreshed intent.
