# Resume — Phase-6 POC, test-pyramid layer (after D.32 landed)

> Paste this into the **existing Phase-6 POC session** to restart the build. The blocker that paused you — the test-pyramid verification-channel gap — is **fixed and archived in dusk** (RFC App. D.32, `test-pyramid-routing`). Reset to the last pre-tests checkpoint and resume building the test-pyramid layer; test intents now route correctly and a mis-decorated test fails loud instead of silently passing. Your full mission/constraints are unchanged — see `phase-6-greenfield-poc-next-prompt.md` for the complete brief; this file is only the resume delta.

---

## 0. What changed in dusk while you were paused (the unblock)

**D.32 `test-pyramid-routing` is landed + archived** (`openspec/changes/archive/2026-06-16-test-pyramid-routing/`; `test-intent-routing` capability synced to `openspec/specs/`). It closes the exact gap that paused you — "is this a test intent?" was decided two inconsistent ways, so an `@intent`-decorated test silently fell through to ordinary verification and could be accepted without the §3.4 two-stage check. Now, in the dusk you'll build against:

- **Suffix routes (identity), marker locates (body).** A test-pyramid intent (path ends in a configured `test_pyramid.suffixes` value) is **always** routed to the Stage-1 test-body pre-pass by its authored suffix — never by the decoration marker. It can no longer fall through to ordinary verification.
- **The Engineer is now taught the test markers.** `ENGINEER_FILE_INSTRUCTION` + a new `dusk/engineer/test-file-decoration` skill state that a test file claims its test intent with `@intent-test-file <path>` (file scope) or `@intent-test` (declaration scope), never `@intent`; and the per-bead task now carries a "this is a test bead" signal. So the common case should now decorate test files correctly on the first pass.
- **A mis-decorated / body-less test fails loud, not silently.** Two new mechanical guards: the gate rejects a focal `@intent`/`@intent-file` claiming a test-suffix intent (`non_test_marker_on_test_intent`) at write time, and a routed test intent with no discoverable body fails with `test_intent_no_test_marker` (pre-pass and test-runner both guard before the model call / before `runVitest`). No silent accept, no green no-op.
- **Suite flakiness was eliminated** (parallel-load oversubscription): bound vitest pool + budgeted integration hook timeouts. The convention is in `.praxis/features/testing.md` — **apply the same parallel-execution + integration-timeout convention to the POC's own vitest config** (its integration tests hit live Postgres and e2e boots HTTP, so the same out-of-process budgeting applies).

Net: the test-pyramid layer is now safe to build. A test that tests nothing will be *rejected*, not waved through.

---

## 1. First: point the POC at the fixed dusk (do not skip)

The POC runs the dusk CLI (`dusk implement`, the gate, the verifier). To get the D.32 behavior you MUST be running the **current** dusk build:

1. In the dusk monorepo: confirm `main` is at the D.32-archived state (the `feat(verifier): route test-pyramid intents by authored suffix` commit is present; `openspec/changes/archive/2026-06-16-test-pyramid-routing/` exists) and **`pnpm build` is green**.
2. Ensure the POC's `dusk` binary/link resolves to *this* freshly-built dusk (re-link / re-install if the POC consumes a built or linked dusk). If the POC runs an older dusk, it will still route by the old (broken) marker logic — verify before building.
3. Sanity check (optional but cheap): in a throwaway, decorate a `*.test.ts` for a `…/unit-tests` intent with `@intent` and confirm the gate now rejects it with `non_test_marker_on_test_intent` (proves you're on the fixed dusk).

---

## 2. Reset to the last checkpoint before tests were built

Per your last instruction in this session ("reset the build once again to the last checkpoint before tests were built"): reset the POC repo (`dusk-notifications-poc`, sibling of the dusk monorepo) to the checkpoint where the **foundation + `app/bootstrap` implementation** exist but **no test files were built** — i.e. before the killed, mis-decorated test build. (That build's worktree was already removed; you identified this checkpoint when instructed to reset.) Confirm a clean tree at that checkpoint before resuming.

---

## 3. Resume: build the test-pyramid layer

Continue the POC build from the test-pyramid layer, with the D.32 behavior now in force:

- Author/confirm the test-pyramid child intents (`…/unit-tests`, `…/integration-tests`, `…/e2e-tests`) for the bootstrap tree as your plan requires (unit for pure leaves; unit+integration for service-layer; unit+e2e for endpoints — per the Phase-6 brief).
- Run `dusk implement` for the test-pyramid beads. Expect the Engineer to decorate test files with `@intent-test-file`/`@intent-test` now (it's taught + signalled). The Stage-1 test-body pre-pass (§3.4) judges whether each test *genuinely* verifies its claim — a tautological/mock-only/no-throw-only test will be **rejected**, which is the point; let the short cycle iterate to a real test.
- If a test bead ever yields a `test_intent_no_test_marker` or a gate `non_test_marker_on_test_intent`, that's the new fail-loud surfacing a real mis-decoration — resolve it through the whitelisted channels (a clearer task answer, re-run), never by hand-editing the test (zero hand-written application code still holds).
- Keep the POC's vitest config aligned with `.praxis/features/testing.md` so its own integration/e2e suites don't hit the oversubscription flakiness.

---

## 4. If the build surfaces another dusk gap

This is the §6.5 corrective loop you've been running (D.29 → D.30 → D.31 → D.32). If the greenfield load surfaces another genuine dusk-side gap, **pause this POC session and hand it back** as an investigation handoff (observed facts + citations, no prescribed fix) — the orchestrator session convenes the arch board, resolves it from first principles, lands the corrective as its own v1.x change, and hands you a resume prompt like this one. Do NOT fix dusk from the POC session, and do NOT hand-write application code to route around a gap.

---

## 5. Guardrails (unchanged — from the Phase-6 brief)

- **Zero hand-written application code** — every line of app source (incl. test bodies) via `dusk_author` + `dusk_implement`, trailer-audited. Suffix routes / marker locates; the gate now enforces the test marker, so the Engineer must use it.
- **Two repos:** you build the POC repo; dusk stays read-only from your side (correctives go back through the orchestrator, §4).
- **Full mission, constraints, and the trailer/coverage axes:** `docs/rfcs/001-mvp-rfc/phase-6-greenfield-poc-next-prompt.md`. The udc sidecar (D.28) is also landed, so `package.json`/config are decoration-coverable toward the 100% bar.

**Reset clean. Confirm you're on the D.32 dusk. Build the pyramid. A bad test now fails loud — let it.**
