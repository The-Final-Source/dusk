# Finding (CORRECTED): `decomposer_bead_conflict` is invalid decoration, NOT a build regression

**Supersedes:** the "decomposer cascade / focal-overlap tightening" hypothesis in
`findings-shortcycle-convergence-livelock.md`.
**Surfaced by:** Phase-6 greenfield POC (`test-dusk`), every feature rebuild whose
closure pulls the `api/conventions` subtree into scope.
**Status:** root cause verified against the dusk source + git history (not inferred
from run behavior). **No dusk code change is required or recommended.**

---

## TL;DR

The earlier hypothesis — *"the dirty `6c7955da6d` build tightened focal-overlap
detection, so we should revert/loosen it (option B)"* — is **wrong on the facts**.

1. **The detection did not change.** The focal-overlap precondition lives in
   `packages/runtime/decomposer/src/dag.ts` and was last modified on **2026-06-10**
   (`24d6d2e`, the original Phase-3 commit). It has not been touched since — not by
   D.28–D.34, not by the launcher branch, not by `6c7955d`. There is **nothing to
   revert**.
2. **The decoration is genuinely invalid.** The POC code stacks **two focal
   `@intent` claims (distinct intents) on the same declaration**. That violates
   Dusk's core focal/support model, and the (unchanged, longstanding) decomposer
   correctly refuses it.

So this is not a regression and not corrupted state — it is a **decoration-discipline
error in the generated POC code**, and the fix is in `test-dusk`, not in dusk.

## The verified facts

### 1. Detection is unchanged since Phase 3
```
git log -1 --format='%h %ci' -S 'produce focal claims on the same code region' \
  -- packages/runtime/decomposer/src/dag.ts
→ 24d6d2e  2026-06-10 16:51:48   feat(P3-T2,T3,T4,T5): bead-decomposition
```
`dag.ts` (3a) refuses when two beads have focal claims keyed to the same
`focalRegionKey = (file, declaration_name | line)`. Error kind
`decomposer_bead_conflict`, `recoverable: false`, message *"beads for A and B
produce focal claims on the same code region."* This is the path firing — **not**
the explicit-`conflicts`-relation path (`test-dusk` has **zero** `conflicts`
relations; only 3 `implies`).

### 2. The POC code has two focal owners per region
`src/notifications/list/handler.ts`:
```ts
26  // @intent notifications/list [keyset-ordering, limit-bounds, ...]
27  // @intent api/conventions/list-envelope [list-envelope-shape, no-bare-array]   ← 2nd FOCAL
28  export async function listNotificationsHandler(...) {
...
65  // @intent-support api/conventions/list-envelope [list-envelope-shape, no-bare-array] ["...sendList wraps items..."]
```
The convention `api/conventions/list-envelope` is decorated **both** as a focal
`@intent` (line 27) **and** as `@intent-support` (line 65) on the same handler. The
focal one is redundant and wrong.

**All double-focal sites in the POC (the demotion blast radius):**
| file | declarations carrying 2+ distinct focal intents |
|---|---|
| `src/api/conventions.ts` | `api/conventions` umbrella co-decorated with `status-codes`, `list-envelope`, `error-envelope` leaves (3 declarations) |
| `src/notifications/list/handler.ts` | `notifications/list` + `api/conventions/list-envelope` |

## "Are the claims conflicting?" — No

`notifications/list` and `api/conventions/list-envelope` do not contradict. The
decomposer is not detecting a logical conflict; it is enforcing **one focal owner
per code region**. In Dusk's model: `@intent` (focal) = "this code *is* my
realization" (exactly one owner per region); `@intent-support` (support) = "this
code corroborates / participates" (many allowed). Two focal owners of one
declaration is ambiguous *ownership* — which bead writes/owns it — not a conflict.

## Why run-1 "passed" (no regression needed to explain it)

The rule is identical across builds, so run-1 did not "allow" two focal owners.
The most likely explanation: run-1's decomposition closure never had **both**
intents active simultaneously (the conventions subtree wasn't in scope yet), so the
latent-invalid decoration was never evaluated as a pair. A feature rebuild now pulls
the conventions into the closure → both intents active → the always-latent overlap
finally trips. The two-focal decoration was invalid all along; it only surfaces when
both intents decompose together.

## Decision

- **Reject (B) "restore serialization / loosen focal-overlap."** There is no
  tightening to revert (verified above), and loosening the invariant would let two
  intents focal-own one region — which silently breaks the **Verifier's** focal-
  evidence scoping (it scopes focal evidence to *the* owning region). That trades a
  loud, correct decomposer error for quiet verifier ambiguity everywhere. Do not do
  this.
- **(A) is the original contract, scoped — and it's smaller than "re-architect."**
  Cross-cutting conventions belong as `@intent-support` on consumers, never a second
  focal `@intent`. The remediation is mechanical, in `test-dusk`:
  1. At the sites above, **demote the second/cross-cutting focal `@intent` to
     `@intent-support`** (in the handler case the support line already exists — just
     remove the redundant focal line 27).
  2. For the `api/conventions` umbrella: an umbrella intent should **not** carry a
     focal claim on the same declaration its leaf owns. Give it its own distinct
     region, make it support-only on the leaves' declarations, or drop its focal
     claim there. (This is the same umbrella-modeling issue as the empty-parent
     finding.)
  3. If the **engineer skill** is systematically emitting a focal claim for every
     convention a handler uses, that skill is the upstream source — note it for the
     dusk team, but it does not block the POC: the per-site demotion unblocks the
     rebuild now.

## Scope / ownership note

The focal-overlap invariant and the focal/support semantics are dusk-core design.
This finding's recommendation is to **work with the invariant** (fix the POC
decoration), not change it. The only thing worth routing to the dusk team is the
*engineer-skill* question — whether it should ever emit a convention as a second
focal `@intent` (it should not). No dusk code change is needed to proceed.

## Update — the remediation is NOT per-site mechanical; it is systemic (engineer-skill is blocking)

`handler.ts` was the easy case (one redundant focal line; support already present —
demoted cleanly). But `src/api/conventions.ts` is not "a few redundant lines" — **every
response helper genuinely realizes 2–3 intents in one function**, and the engineer
focal-claimed all of them:

| declaration | focal intents stacked |
|---|---|
| `sendOk` | `status-codes` + `api/conventions` |
| `sendCreated` | `status-codes` + `api/conventions` |
| `sendList` | `list-envelope` + `status-codes` + `api/conventions` |
| `sendValidationError` | `error-envelope` + `status-codes` + `api/conventions` |
| `sendConflict` | `error-envelope` + `status-codes` + `api/conventions` |
| `sendInternalError` | `error-envelope` + `status-codes` + `api/conventions` |

This is not fixable by "remove the redundant line," because the **code legitimately
realizes multiple intents in one declaration** (`sendValidationError` sets the 400
status *and* the error-envelope shape *and* content-type). "One focal owner per region"
forces two of the three to support-only. And `status-codes` is itself cross-cutting —
its `400`/`409`/`500` aspects each live in a *different* error helper that
`error-envelope` already focal-owns — so `status-codes` has **no non-overlapping focal
home at all**. Demoting it everywhere makes it (and `api/conventions`) **support-only**,
which lands exactly on the D.29 "an intent claimed only by support records defaults to
fail" concern.

**So the open question is genuinely a decoration-model decision the dusk team owns:**
when one declaration realizes N intents, what is the correct decoration? Options the
engineer-skill must pick and apply consistently: (a) one focal + the rest `@intent-support`
*and the verifier must treat a support-only intent as satisfiable* (the D.29 path —
confirm it holds for the semantic channel); or (b) the engineer splits the helpers so
each realizes one intent (function/file-per-intent), which the engineer-skill would have
to drive at authorship. Either way, **the fix belongs in the engineer skill + a clean
rebuild**, not a hand-demote of generated code — a hand-demote both dings the
"zero hand-written application code" thesis (these commits would carry no trailers) and
requires guessing the focal/support split the verifier will accept.

**Recommendation:** treat the engineer-skill as the blocking fix for the conventions
subtree (not "non-blocking"). Decide (a) vs (b), encode it in the engineer skill, then
rebuild `src/api/conventions.ts` (and any handler that stacks a convention as a second
focal) through the pipeline so the corrected decoration is pipeline-produced with
trailers. The `handler.ts` one-line demote is the only genuinely mechanical site.

## Next step for the test-dusk session

Demote the double-focal sites above to `@intent-support` (remove the redundant
focal lines; keep/add the support claims), then re-run on a `dusk version`-confirmed
build. The decomposer conflict should clear, and the run advances to the next wall
(the Stage-2 reporter-argv issue), now on a correct decoration model.
