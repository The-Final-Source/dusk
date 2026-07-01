# Finding: short-cycle does not exit on a converged (all-pass) verdict — 3.5h livelock

**Surfaced by:** Phase-6 greenfield POC (`test-dusk`), `dusk implement` of the
`notifications/list` feature, bead `bd_20260617162918007` =
`notifications/list/integration-tests`.
**Severity:** HIGH (orchestration correctness + finite-iteration guarantee defeated).
**Status:** diagnosed from the trace stream; **fix decision deferred to the dusk agent.**
**Disposition note:** the dusk agent decides the fix. This document is evidence +
analysis only; do not treat the recommendations as prescriptive.

---

## 1. One-paragraph summary

A test-intent bead reached an **all-triples-pass** short-cycle verdict at iteration 3
and then **re-entered the short cycle 69 more times on that same passing verdict**,
never committing and never advancing to test execution. It ran ~3.5 hours of real
`engineer → verifier → bead-orchestrator` cycles before it was killed manually. Three
independent loop-bounding mechanisms all failed to fire: (a) convergence-detection
never committed the passing bead, (b) the stuckness/livelock detector never tripped
despite 69 byte-identical verdicts, and (c) the short-cycle `iteration_number` was
stuck at `1`, so the `short_cycle_max_iterations` (20) and `bead_lifetime_iterations`
(40) caps could never backstop. The verifier was **not** the problem and the intent
**was** satisfiable — it was satisfied by loop 2–3.

## 2. What happened (timeline)

- 5 beads in the run committed normally (`api/conventions`, `…/list-envelope`,
  `…/error-envelope`, `notifications/list`, `notifications/list/cursor-codec`),
  including the **unit-test** bead. Those are on `main` (salvaged via fast-forward).
- Bead `bd_20260617162918007` (the **integration-test** bead) entered the short cycle
  and never left it. `invocation_site` for **all 213** of its trace events is
  `short-cycle` — it **never reached `test-execution` (Stage 2)**. So this is not the
  Stage-2 test-runner / result-schema path at all; it is the Stage-1 short cycle.
- Total: **71 engineer + 71 verifier + 71 bead-orchestrator** events for this one bead.

## 3. Evidence (from `.ia/observability/traces.jsonl`, filtered to the bead)

Orchestrator trace fields per loop (`bead-orchestrator` role):

| loop | failing_triple_set | stuckness_detector_state | convergence_diagnosis_present | iteration_number |
|---|---|---|---|---|
| 1 | `[covers-limit-bounds, covers-offset-prohibited]` | `{fired: False}` | `False` | 1 |
| 2 | `[]` (both flipped to pass) | `{fired: False}` | `False` | 2 |
| 3 | `[]` — **all 6 covers-\* pass** | `{fired: False}` | `False` | 1 |
| … | `[]` | `{fired: False}` | `False` | 1 |
| 71 | `[]` | `{fired: False}` | `False` | 1 |

- `failing_triple_set` is **empty for loops 3–71** (69 consecutive all-pass verdicts).
- `verdict_delta_from_prior` is identical for those 69 loops (no flips, no new failures).
- `engineer_change_summary` from loop 3 on is self-describing: *"The test file … is
  already fully implemented and covers…"* — the engineer has nothing left to do and
  says so, every loop.
- `stuckness_detector_state` = `{fired: False}` for **all 71** loops.
- `convergence_diagnosis_present` = `False` for **all 71** loops.
- `iteration_number` (verifier traces) = `1` for 70 of 71 loops (one `2`). **It does
  not increment**, so the finite-iteration caps are dead.
- Engineer `completion_tokens` per loop: `28173, 12142` (initial drafts) then settling
  to ~2000–3000 (no-op "already done" turns) for the remaining 69 loops — real model
  spend each loop, ~44s per verifier turn → ~3.5h total.

## 4. Root cause

**The short cycle has no working transition out of a converged (all-pass) verdict for
this bead.** Once `failing_triple_set` is empty, the bead should commit (and, for a
test-intent, advance to Stage-2 test execution). Instead it re-enters
`engineer → verifier` indefinitely. The trace shows the data needed to stop is present
and correct (empty failing set, identical verdicts), but **no mechanism acted on it**:

1. **Convergence → commit not firing.** `convergence_diagnosis_present` stays `False`
   through 69 all-pass verdicts. Whatever decides "verdict is clean → commit / advance"
   never triggered for this bead type.
2. **Stuckness/livelock detector not firing.** 69 byte-identical verdicts with no
   engineer change is the textbook stuck state, yet `stuckness_detector_state.fired`
   stays `False`. The detector exists and is wired into the trace, but its predicate
   did not match this shape (possibly it only looks for *oscillating/failing* states,
   not a *stably-passing-but-not-committing* state).
3. **Finite-iteration cap defeated.** `iteration_number` does not advance past 1, so
   `short_cycle_max_iterations` (20) and `bead_lifetime_iterations` (40) never bound
   the loop. This removes the last backstop — the loop is unbounded in iterations
   (only bounded by wall-clock / manual kill / any lifetime token budget).

The likely interaction: a test-intent bead, after a clean short-cycle verdict, is
supposed to hand off to Stage-2 (run the test) or commit; that handoff appears to be
missing/short-circuited, and it loops back into Stage-1 instead — while the counter
that would have capped the loop is also not incrementing.

## 5. Observability assessment (the angle explicitly raised)

Observability was largely the **hero**, not the gap: the `bead-orchestrator` trace
already carries exactly the fields that diagnose this — `stuckness_detector_state`,
`convergence_diagnosis_present`, `verdict_delta_from_prior`, `failing_triple_set`,
`engineer_change_summary`. Without them this would have been opaque. Two real gaps,
both minor relative to the control-flow bug:

- **Verifier token accounting is zeroed.** Every `verifier` trace logs
  `prompt_tokens: 0, completion_tokens: 0, cost_usd: 0` despite ~44s latency and a real
  verdict. Cost of a runaway verify loop is therefore invisible in the trace stream.
- **`iteration_number` is meaningless** (stuck at 1). It is both a control bug (caps
  rely on it) and an observability bug (you can't see loop depth from a trace).
- Verdicts are not persisted to disk (ephemeral); only the orchestrator's *delta*
  summary survives in the trace. Adequate here, but a persisted last-verdict per bead
  would make post-mortems trivial.

## 6. Recommendations (dusk agent decides)

Ranked; the agent should choose scope and implementation.

1. **Primary — make a clean short-cycle verdict terminal.** When
   `failing_triple_set` is empty (all `covers-*` / triples pass), the bead must leave
   the short cycle — commit, or for a test-intent advance to Stage-2 test execution.
   This is the actual defect; everything else is defense-in-depth. Add a regression
   test that a bead with an all-pass verdict at iteration *k* commits at *k*, not *k+n*.
2. **Defense-in-depth — fix `iteration_number` increment.** Ensure the short-cycle
   counter advances per `engineer → verifier` round so `short_cycle_max_iterations` /
   `bead_lifetime_iterations` actually bound the loop. A counter-stuck bead today has
   **no** finite-iteration guarantee.
3. **Defense-in-depth — broaden stuckness detection to the stable-no-progress case.**
   The detector should fire on *N* consecutive identical verdicts with no engineer
   change (`verdict_delta_from_prior` empty *N* times), not only on oscillation/failure.
   A stably-passing-but-not-committing bead is as stuck as a failing one.
4. **Observability — capture verifier token usage** (non-zero `prompt_tokens` /
   `completion_tokens` / `cost_usd`) so runaway verify loops are costed in-stream.
5. **Optional — author-side ergonomics.** The triple `covers-offset-prohibited`
   ("the integration test verifies the endpoint does **not** issue an offset query") is
   a hard-to-test negative; it was the last triple to flip to pass (loop 2). Not the
   cause here (it did pass), but worth a note that negative *coverage* triples are
   awkward to satisfy and may deserve an authoring lint.

## 7. Reproduction pointers

- POC repo: `/Users/tylersmith/Documents/Project/test-dusk`
- Trace stream: `.ia/observability/traces.jsonl`, filter
  `bead_id == "bd_20260617162918007"` (213 events, all `invocation_site: short-cycle`).
- Intent under test: `.ia/intents/notifications/list/integration-tests/intent.yaml`
  (`compose: all`, 6 `covers-*` triples — all satisfiable, all satisfied by loop 3).
- Config: POC `dusk.config.yml` uses defaults (`short_cycle_max_iterations: 20`,
  `bead_lifetime_iterations: 40`) — neither fired because the counter is stuck.

---

# Follow-up finding (after the livelock fix): `decomposer_bead_conflict` on multiple focal claims in one file

**Surfaced by:** re-running `notifications/list/integration-tests` against the rebuilt
`dusk` (`6c7955da6d`, built dirty). The short-cycle livelock fix is **confirmed
working** — both re-runs exited in seconds with no runaway. But the integration bead
can no longer be built; it fails at the **decomposer**, before any bead runs:

```
implement: decomposer_bead_conflict — beads for "api/conventions" and
"api/conventions/list-envelope" produce focal claims on the same code region
```

`--scope notifications/list/integration-tests` and additionally `--base-ref HEAD`
both hit it (the dependency closure is re-decomposed regardless).

**The structure that triggers it (pipeline-produced in run 1):**
`src/api/conventions.ts` carries FOUR distinct focal `@intent` claims —
`api/conventions` (umbrella, `json-content-type`), `api/conventions/list-envelope`,
`api/conventions/error-envelope`, `api/conventions/status-codes`.

**The regression signal:** in run 1, with all six intents **top-level scoped**, the
decomposer built these as **separate serialized beads** that committed cleanly
(`b5be54e api/conventions`, `950076c …/list-envelope`, `e406d98 …/error-envelope` on
`main`). The **rebuilt** decomposer now treats two co-scheduled focal claims on one
file as a hard **conflict** instead of a serialization edge. So the pipeline produced
a structure the current decomposer refuses to re-process — an internal inconsistency.

**Open question for the dusk agent:** is this (a) an intended tightening (focal
overlap should be a hard error, in which case the *engineer* must never co-locate
multiple focal-claimed intents in one file, and run-1's output is itself invalid), or
(b) a regression in the dirty `6c7955da6d` build where focal-overlap **serialization**
(observed working in run 1) was lost? Either way it currently blocks every
list-feature rebuild. Repro: `cd test-dusk && dusk implement "…"
--scope notifications/list/integration-tests`.

### Update — it is a CASCADE, and the second instance is run-1 code

After deleting the `api/conventions` umbrella (a genuine fix — an umbrella must not
also carry a focal cross-cutting triple), the retry produced a **new** conflict:

```
decomposer_bead_conflict — beads for "api/conventions/list-envelope" and
"notifications/list" produce focal claims on the same code region
```

`src/notifications/list/handler.ts` (built + committed in run 1) carries **two focal
`@intent` claims on the same lines**:
```
// @intent notifications/list [keyset-ordering, limit-bounds, …]
// @intent api/conventions/list-envelope [list-envelope-shape, no-bare-array]
```
…yet the handler only **calls** `sendList` (imported from `conventions.ts`, which
already focal-owns `list-envelope`). So `list-envelope` is focal-claimed in *two*
files, and in the handler it co-locates with `notifications/list`.

**Decisive evidence this is a behavior change, not just bad intents:** that exact
double-focal handler was **built and committed by the released dusk in run 1**
(`e7ab2a8 notifications/list` + `950076c …/list-envelope` are both on `main`). The
released decomposer **serialized** it; the dirty `6c7955da6d` build **hard-refuses**
it. The likely culprit is a tightening of `buildBeadDag`'s focal-overlap detection,
plausibly a side-effect of the short-cycle/livelock fix.

**The fork (needs a dusk-level decision):**
- **(A) Tightening is intended** → "exactly one focal owner per code region" becomes
  the contract. Then the **engineer skill** must be fixed so a consumer that delegates
  to a convention's helper claims the convention as `@intent-support`, never a second
  `@intent`; and all run-1 code must be re-decorated. This blocks *every* feature
  build (the create handler will claim `error-envelope`, `status-codes`,
  `idempotent-writes`, `write-endpoint`, `handler-logging-discipline` the same way).
- **(B) Regression** → restore focal-overlap **serialization** (run-1 behavior); the
  POC needs no rework beyond the (correct) `api/conventions` umbrella removal.

**Note on POC state:** the `api/conventions` umbrella intent was deleted (correct), so
`src/api/conventions.ts` currently has 7 orphaned `@intent api/conventions` markers
pending a re-decoration rebuild. This is easily reverted if direction (B) is chosen.
