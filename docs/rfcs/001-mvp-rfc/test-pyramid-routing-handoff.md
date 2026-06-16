# Handoff — Build `test-pyramid-routing` (D.32), then resume the Phase-6 POC

> Paste this whole file as the opening prompt for a **fresh session**. Its job: implement the already-designed, board-converged, validated OpenSpec change `test-pyramid-routing` in the **dusk monorepo**, get tests green, archive. After it lands, the Phase-6 greenfield POC (paused at the test-pyramid layer) resumes. This is **execution against a validated change**, not redesign.

---

## 0. Mission in one paragraph

A Phase-6 POC build surfaced a verified gap (RFC **App. D.32**): "is this a test intent?" is decided two inconsistent ways — by the **authored path suffix** (orchestrator + `dusk_inspect`) and by the **decoration marker** (`testDiscovery`, used by the CLI verifier + pre-pass + test-runner). When an Engineer decorates a test file with `@intent` instead of `@intent-test`/`@intent-test-file` — which it does, because it was **never taught the test markers** — `testDiscovery` is empty and the CLI verifier **silently falls through** to ordinary verification, where a tautological/mock-only test can be **silently accepted**, defeating §3.4's two-stage test satisfaction and violating "no silent behavior." The fix (board-converged, captured in `openspec/changes/test-pyramid-routing/` — proposal + design D1–D7 + 2 specs + tasks; `openspec validate --strict` passes): **route test-identity by the authored suffix (one source of truth), keep the marker as the test-body locator (required + gate-enforced), fail loud on a missing body, and teach the Engineer.** Implement that change task-by-task, then archive. When green, hand back — the POC resumes.

---

## 1. Context — what Dusk is, where we are

Dusk is a constraint-satisfaction system for spec-driven AI development: authors write **intents** (YAML, slash-pathed, with triples); code is **decorated** with markers linking lines to triples; a **Verifier** judges adherence; a headless **Engineer** drafts code in a worktree under a **short cycle**; a post-hoc **gate** hard-blocks undecorated/uncovered writes. Repo: the **dusk monorepo** (you work here), TS strict ESM, pnpm + Turborepo, Vitest, `@dusk/*` packages.

**Where this sits:** v1 is landed (Phases 1–5). The Phase-6 greenfield POC (a notifications API built through dusk with zero hand-written code) is exercising shipped v1 behavior on its native terrain and surfacing arch-board-resolved correctives — **D.29/D.30/D.31** (structural verification channel, already landed) and now **D.32** (this change). Each lands before the POC proceeds past the layer that surfaced it. The POC is **paused at the test-pyramid layer** pending this.

**Delivery discipline (NON-NEGOTIABLE):** spec-driven via OpenSpec; the change exists and is validated — drive it with `/openspec-apply-change test-pyramid-routing`. Conventional commits. ALWAYS run `pnpm build`, `pnpm test`, `pnpm typecheck`. Functional-first, Zod = source of truth, named exports, `type` over `interface`, files < 500 lines, colocated `*.test.ts`.

---

## 2. The verified gap (independently confirmable)

- `TEST_MARKERS = {intent-test, intent-test-file}`; `FOCAL_MARKERS = {intent, intent-file, intent-test, intent-test-file}` — `core/index/src/derivedIndex.ts:62-63`. `@intent` is focal but NOT a test marker.
- `testDiscovery(path)` filters by `TEST_MARKERS` (`derivedIndex.ts:132-133`) → empty for an `@intent`-decorated test intent.
- CLI verifier routes to the Stage-1 pre-pass iff `testDiscovery > 0`, else falls through to ordinary `verifyIntent` — `cli/src/implement.ts:352-356`.
- Body-discovery (which file is the test body) also keys on `testDiscovery` — `runtime/benchmark/src/testPrepass.ts:49-50`, `runtime/test-runner/src/{run.ts:65,discovery.ts}`.
- Two-way inconsistency: suffix-based consumers (`runtime/orchestrator/src/stateMachine.ts:~167`; `delivery/mcp-server/src/queries.ts:~110`, its own `TEST_SUFFIXES_RE`) vs marker-based (the verifier/pre-pass/test-runner above).
- Gate Check 9 (`delivery/pre-tool-use/src/checks.ts:212-217`) is forward-only (test-marker ⇒ test-suffix path); no reverse.
- Engineer guidance: `ENGINEER_FILE_INSTRUCTION` (`cli/src/implement.ts:187-200`) + every `dusk/engineer/*` skill name only `intent`/`intent-file`; per-bead task is bare `Implement <path>`. `intent-test` appears nowhere the Engineer sees.
- `testPyramidSuffixes(config)` exists (`core/schema`) and is available in the verifierFactory via `ctx.config`.

---

## 3. The design (board-converged — full text in `openspec/changes/test-pyramid-routing/design.md` D1–D7)

- **D1 — Route by the authored suffix, not the marker.** The verifier routes a test-suffix intent to the Stage-1 pre-pass on `isTestIntentPath(path, config)`, never on `testDiscovery > 0`. A test-suffix intent can never fall through to ordinary verification → silent-accept structurally impossible. This is **D.30 on a new axis** (routing follows an authored property, not a fallible decoration artifact).
- **D2 — Suffix and marker answer two questions (the crux).** Suffix → *is this a test intent?* (identity/routing, authored). Marker → *which file is the test body?* (evidence location, Engineer-supplied, required). The marker is **load-bearing** (a suffix can't name a file) — so "drop the marker / derive from suffix" is REJECTED; this is exactly where the D.30 analogy stops.
- **D3 — Fail loud + legible on a missing body.** A routed test intent with empty `testDiscovery` returns a specific `test_intent_no_test_marker` (naming the intent + expected markers), never a silent skip nor the generic "test does not verify." Same guard on the test-runner path.
- **D4 — Reverse of gate Check 9.** A focal marker (`intent`/`intent-file`) whose `intent_path` is a test-suffix intent → reject `non_test_marker_on_test_intent` at write time (the mechanical guarantee the body-locating marker is present). **Scoped exactly:** fires only on the focal claim *of the test-suffix intent itself*; `@intent-support` and `@intent` claiming a *non-test* intent in a test file stay legitimate.
- **D5 — Teach the Engineer + signal the test bead.** Instruction + a `dusk/engineer/*` skill name the test markers; the per-bead task signals "this is a test bead." Routing + gate make failure honest; this makes success possible (a rate-improver, never a correctness guarantee).
- **D6 — Orthogonal to D.29/D.30/D.31.** Test routing is a *prior* fork (which instrument); structural-vs-semantic (`verify`) is *within* the ordinary path. No third `verify` value; no touching the `semanticRecords` partition.
- **D7 — One shared suffix predicate.** Extract/reuse `isTestIntentPath` consumed by the verifier, orchestrator, and inspect — kills the duplication that caused the inconsistency.

---

## 4. Build plan (authoritative: `openspec/changes/test-pyramid-routing/tasks.md`)

Drive with `/openspec-apply-change test-pyramid-routing`. Dependency order: §1 shared predicate → §2 route by suffix → §3 fail-loud → §4 reverse gate check → §5 Engineer guidance → §6 integration + archive. Mechanical pieces (§1–§4) are zero-model with colocated Vitest; §5 is model-facing guidance.

---

## 5. Constraints / non-goals

- **Suffix routes (identity); marker locates (body).** Do not conflate them; do not drop the marker; do not derive routing from the marker.
- **No third `verify` channel value** — test routing is a separate axis from structural/semantic (D.29/D.30/D.31).
- **No `kind: test` authoring field** — the suffix already declares test-identity.
- **No filesystem-position body-discovery** — discovery stays marker-based; a missing marker fails loud, it is not worked around by path heuristics.
- **One shared suffix predicate** — no new per-consumer copy.
- Mechanical guards (routing, gate, fail-loud) are the correctness guarantees; Engineer guidance is a rate-improver only.

---

## 6. Definition of done

- `openspec/changes/test-pyramid-routing/tasks.md` fully checked; `openspec validate test-pyramid-routing --strict` passes.
- A test-suffix intent whose only claimant is `@intent` routes to the pre-pass (never ordinary verification) and fails `test_intent_no_test_marker` — proven by a unit test (not just observed).
- The gate rejects `@intent` claiming a test-suffix intent (`non_test_marker_on_test_intent`); does NOT reject `@intent-support` nor `@intent` claiming a non-test intent in a test file; passes `@intent-test-file`.
- One shared suffix predicate consumed by verifier + orchestrator + inspect; no divergent copy.
- Engineer instruction + a skill name the test markers; per-bead task signals a test bead.
- Integration: `@intent`-decorated test → loud reject; `@intent-test-file` test → pre-pass judges it (and can reject for genuine §3.4 test-quality reasons — the guarantee is restored).
- `pnpm build`/`typecheck`/`test` green; change **archived** (synced to `openspec/specs/`).
- Defects surfaced during the build handled per the D.11 policy (scoped fix + regression test + living-spec delta).

---

## 7. Return path

Once archived and green, the Phase-6 greenfield POC (paused at the test-pyramid layer) resumes in its own session — its test-pyramid intents now route correctly, the Engineer is taught the markers, and a mis-decorated test fails loud instead of silently passing. Do NOT touch the POC repo or the Phase-6 change from this session.

---

## 8. Source-of-truth references

- `openspec/changes/test-pyramid-routing/` — proposal.md, design.md (D1–D7), specs/{test-intent-routing, pretooluse-gate}/spec.md, tasks.md. THE build contract.
- RFC `docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md` — **App. D.32** (the decision), **§3.4** (test-identity-is-the-suffix note), **§4.6 + App. A.8** (the reverse Check 9 / `non_test_marker_on_test_intent` v1.x note), and **D.29/D.30/D.31** (the adjacent verification-channel series — for the orthogonality boundary).
- `CLAUDE.md` (repo root) — conventions.

**Build for right. Suffix routes, marker locates. Kill the silent path. Then hand back.**
