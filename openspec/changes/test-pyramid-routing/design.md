## Context

This change resolves RFC App. D.32 — the fourth in the Phase-6-POC verification-channel board series (D.29 structural channel; D.30 channel-is-a-property-of-the-claim; D.31 structural-channel honesty; **D.32 test-routing**). The gap: a test-pyramid intent decorated with `@intent` (focal, not a test marker) makes `testDiscovery` empty, so the CLI verifier silently routes its `covers-*` triples to ordinary verification, which cannot detect a tautological/mock-only test → silent false accept, defeating §3.4's two-stage test satisfaction.

The board (architect, backend, AI eng, Fowler) investigated and debated five candidate fix loci and converged. The verified facts the design rests on:
- `TEST_MARKERS = {intent-test, intent-test-file}`; `FOCAL_MARKERS = {intent, intent-file, intent-test, intent-test-file}` (`core/index/src/derivedIndex.ts:62-63`). `@intent` is focal but not a test marker.
- `testDiscovery(path)` filters by `TEST_MARKERS` (`derivedIndex.ts:132-133`) — empty for an `@intent`-decorated test intent.
- Routing today: `cli/src/implement.ts:354` enters the pre-pass iff `testDiscovery > 0`, else falls through to ordinary `verifyIntent`.
- Two inconsistent test-identity mechanisms: **suffix-based** (`runtime/orchestrator/src/stateMachine.ts:~167`; `delivery/mcp-server/src/queries.ts:~110`) vs **marker-based** (`cli/src/implement.ts:354`; `runtime/benchmark/src/testPrepass.ts:49`; `runtime/test-runner/src/{run,discovery}.ts`).
- Body-discovery (the pre-pass + test-runner finding *which file* is the test body) keys on `testDiscovery` (markers) — `testPrepass.ts:49-50`, `test-runner/run.ts:65`.
- Gate Check 9 (`delivery/pre-tool-use/src/checks.ts:212-217`) is forward-only: test-marker ⇒ test-suffix path. No reverse.
- Engineer guidance: `ENGINEER_FILE_INSTRUCTION` (`implement.ts:187-200`) + every `dusk/engineer/*` skill name only `intent`/`intent-file`; the per-bead task is bare `Implement <path>`. `intent-test` appears nowhere the Engineer sees.
- `testPyramidSuffixes(config)` exists (`core/schema`) and is already available in the verifierFactory via `ctx.config`.

## Goals / Non-Goals

**Goals:**
- Make a silent false-accept of a test-pyramid intent **structurally impossible**.
- Establish **one** source of truth for test-identity (the authored suffix) and remove the two-way inconsistency.
- Keep the test markers in their genuine role (body location) and make their presence a **mechanically enforced, loudly-surfaced** invariant.
- Give the Engineer real guidance + a per-bead signal so the common case succeeds.

**Non-Goals:**
- Dropping the marker / deriving it from the suffix (rejected — the marker locates the body; D.30 has no body-location analog).
- A third `verify`-channel value or any blending with the D.29/D.30/D.31 structural/semantic axis (orthogonal — see D6).
- A new authoring field (`kind: test`) — the suffix already declares it; a new field would be a third routing axis to keep consistent.
- Re-basing body-discovery on filesystem position (a second, path-coupled discovery mechanism that contradicts the rest of the decoration model).

## Decisions

### D1 — Routing follows the authored suffix; the marker is not the router
`verifierFactory` decides "test intent → Stage-1 pre-pass" from `testPyramidSuffixes(ctx.config).some(s => intentPath.endsWith("/"+s))`, NOT from `testDiscovery(path).length > 0`. A test-suffix intent can therefore never fall through to ordinary `verifyIntent`. This is the **D.30 principle on a new axis**: the routing decision follows an authored property of the claim (the path the author created), not a decoration artifact the fallible Engineer stamped. *Alternative considered & rejected:* keep marker-based routing and only add a guard — rejected, it leaves test-identity defined by a fragile re-derivation of an authored fact, and the inconsistency persists.

### D2 — Suffix and marker answer two different questions (the crux)
- **Suffix** → *is this a test intent?* (identity/routing). Authored, infallible-relative-to-Engineer.
- **Marker** (`@intent-test`/`@intent-test-file`) → *which file/region is the test body?* (evidence location). Engineer-supplied, required, enforced. `testDiscovery` stays the body-locator the pre-pass/test-runner read.

They are NOT redundant sources of one truth — conflating them was the bug. The marker is **load-bearing** (a suffix cannot name a file), so "derive routing from suffix and drop the marker" is wrong: it would leave the pre-pass with no way to find the body. *This is the precise boundary where the D.30 analogy stops* — D.30 governs channel/routing selection (here: suffix), but has no evidence-location component (here: marker).

### D3 — A routed test intent with no body fails loud and legibly
After D1, a test-suffix intent always reaches the pre-pass. An empty `testDiscovery` (no marker → no body) is **not** safe on either path today — the guard is load-bearing, not just nicer messaging:
- **Pre-pass:** an empty body is still sent to the model (`testPrepass.ts:49-62`); nothing forces `genuinely_verifies:false`, so the model *could* return `true` → a silent accept.
- **Test-runner:** empty `testFilesFor`/`discoverTestClaims` flows to `runVitest([])` → zero files run → a **silent GREEN pass** (no triple ever judged) — the worst residual.

So a `test_intent_no_test_marker` guard SHALL be inserted **before** the model `complete()` call (pre-pass) and **before** the Stage-2 `runVitest` call (test-runner): an explicit pre-check on empty `testDiscovery` returning a specific recoverable error naming the intent + expected markers — never the model's verdict on an empty body, never a green Vitest no-op, never the generic "test does not verify." Honors "no silent behavior" and gives the short cycle an actionable cause. (This is a verdict-channel `DuskError` kind — it must be added to `DUSK_ERROR_KINDS` — distinct from the gate kind `non_test_marker_on_test_intent`.)

### D4 — Reverse of Check 9 enforces the marker invariant at write time
A new **reverse gate check (the reverse of Check 9)** — a gate-only rejection kind, NOT a new numbered §4.6 check (mirroring how D.28's coverage kinds are framed): a record whose `marker ∈ {intent, intent-file}` (focal, non-test) and whose `intent_path` ends in a configured suffix → reject `non_test_marker_on_test_intent`, message pointing at `@intent-test`/`@intent-test-file`. This is the mechanical guarantee that the body-locating marker is present — at the earliest, most actionable point — rather than relying solely on probabilistic guidance. It answers a *distinct* question from D1's routing (presence of the body-locator, not identity), so it is not a redundant routing guard (Fowler's anti-pile-on is satisfied: one router = the suffix; this enforces the marker payload). **Scoping (resolves "is `@intent` ever legitimate on a test file?"):** fires ONLY when the focal marker's `intent_path` IS the test-suffix intent. `@intent-support` (legitimately abundant in test files) and `@intent` claiming a *non-test* intent that lives in a test file are untouched. Forward Check 9 is unchanged; the pair enforces *test-suffix intent ⟺ test-marker claimant present*.

### D5 — Teach the Engineer + signal the test bead
`ENGINEER_FILE_INSTRUCTION` and a `dusk/engineer/*` skill state: a file implementing a test-suffix intent claims it with `@intent-test-file <path>` (file scope) or `@intent-test` (declaration scope), never `@intent`. The per-bead Engineer task gains an explicit "this is a test bead — its file body is the evidence the pre-pass judges" line when the target intent path ends in a configured suffix. Routing (D1) + the gate (D4) make failure honest and mechanical; D5 makes the **common case succeed** — without it the pre-pass forever sees an empty body and the bead burns to budget. This is the single model-facing piece; it is a rate-improver, never a correctness guarantee.

### D6 — Orthogonality to the structural/semantic channel (D.29/D.30/D.31)
Test-vs-non-test routing is a **prior fork** (which *instrument* judges the claim: the test-body pre-pass vs ordinary verification). Structural-vs-semantic (`verify`) is a choice *within* the ordinary path (how an ordinary claim is judged). They are independent axes; this change adds no `verify` value and does not touch the `semanticRecords` partition. A test intent's `covers-*` triples are judged by the pre-pass, full stop — they never enter the structural/semantic fork.

### D7 — One shared suffix predicate (kill the duplication at the root)
Extract/reuse a single `isTestIntentPath(path, config)` (over `testPyramidSuffixes`, in the `@dusk/core-schema` leaf — no circular deps) consumed by the CLI verifier (new), the orchestrator (`stateMachine.ts:167,401`), and inspect (`queries.ts`). One implementation, per "extract at 3+ repetitions / one concept per file." This structurally prevents the inconsistency from recurring — and is **stronger than a refactor: it fixes a latent bug.** `queries.ts`'s `TEST_SUFFIXES_RE` is not merely a duplicate — it is **config-blind and divergent** (hardcodes 5 suffixes incl. `contract-tests`/`property-tests`, which are NOT the v1 defaults), so `dusk_inspect` today silently ignores `dusk.config.yml` suffix overrides and treats `…/contract-tests` as a test intent while the suffix-config consumers do not. Routing all three through the config-driven predicate is therefore a **behavior change** (the intended correction), not a pure refactor — tasks §1.1 notes this. The shared predicate must preserve the orchestrator's existing semantics (`suffixes.includes(p.split("/").at(-1))` ≡ `endsWith("/"+s)` for single-segment suffixes).

## Risks / Trade-offs

- **[Blast radius beyond the CLI path]** — `testChildrenByLayer`, orchestrator Stage-2 execution, adherence rollups also key on test markers/suffix. **Mitigation:** the D4 invariant (suffix ⟺ marker present) makes them agree; no separate fix needed, but tasks include an assertion that they're consistent under the invariant.
- **[Engineer still slips despite D5]** — guidance is probabilistic. **Mitigation:** D4 (gate, write-time) + D3 (fail-loud verify-time) make every slip loud and non-damaging; D5 only reduces the rate.
- **[Over-correction / pile-on]** — Fowler flagged not stacking five loci. **Mitigation:** **four mechanism pieces** (D1 route-by-suffix / integrity, D3 fail-loud / legibility, D4 reverse-gate / enforcement, D5 teach-Engineer / liveness) over **one model** (D2 suffix-routes-marker-locates) and **one shared predicate** (D7) — each closing a distinct hole. The two declined loci — (d) author-flow and (e) drop-the-marker — are explicitly rejected with reasons (above and in Non-Goals).
- **[D.30 analogy over-extended]** — applying "authored property routes" to drop the marker entirely. **Mitigation:** D2 pins the boundary — D.30 governs routing, not evidence-location.

## Migration Plan

Additive + corrective within the dusk monorepo; no data migration. Sequence: (1) extract `isTestIntentPath` shared predicate; (2) route the CLI verifier by it (D1); (3) fail-loud-empty-body in the pre-pass + test-runner (D3); (4) reverse-Check-9 + new rejection kind (D4); (5) Engineer instruction + skill + per-bead signal (D5); (6) integration test composing the lot. The suffix-based consumers are unchanged in behavior (they already route by suffix). This is a v1.x corrective fix to shipped v1 behavior, surfaced by the POC; it lands **before the Phase-6 POC resumes** (the POC build is paused at the test-pyramid layer pending it).

## Open Questions

None. The board converged; the five candidate loci were resolved — three adopted as mechanism (route-by-suffix, fail-loud, reverse-gate) plus guidance (D1/D3/D4/D5), over the D2 model and the D7 shared predicate; author-flow and drop-the-marker declined with recorded reasons. A materialization re-audit (4 reviewers) then verified the authored artifacts and the plan weave; its fixes are folded in.
