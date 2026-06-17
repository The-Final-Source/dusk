# Resume — Phase-6 POC (after D.34 / boundary-outcome-handling landed)

> Paste this into the **existing Phase-6 POC session** to restart the build. The non-convergence that paused you — a bead looping ~21× re-drafting *correct* code — is **fixed and archived in dusk** (RFC App. D.34, `boundary-outcome-handling`). The earlier "Stage-2 vitest worker-pool flake" diagnosis was **wrong and is superseded**. Your full mission/constraints are unchanged — see `phase-6-greenfield-poc-next-prompt.md` for the complete brief; this file is only the resume delta. **It includes one required project-side task (the test-result adapter, §2) — do that before you expect a Stage-2 test verdict.**

---

## 0. What changed in dusk while you were paused (the unblock)

**D.34 `boundary-outcome-handling` is landed + archived** (`openspec/changes/archive/2026-06-17-boundary-outcome-handling/`; the `boundary-outcome-handling` capability synced to `openspec/specs/`). The corrected diagnosis (verified against your preserved traces, bead `bd_…005`): the **test runner was never reached**; **30 of 34 short-cycle Verifier calls returned 0-token responses at 25–74 s** under extreme concurrent load, and the degraded response was **silently coerced into a definite, falsely-converging verdict** (`?? false` / `?? "vague"` / `genuinely_verifies ?? false`) — the smell Fowler named **"inferring verdict from silence."** It is the 4th instance of the D.26→D.33 lesson, so the principle was **extracted, not patched again**. In the dusk you'll build against:

- **The governing principle (RFC §1.2.1) is now enforced.** Dusk's deterministic core acts only on signals it authored or that are universal (its own timeout; whether bytes parse into Dusk's **own** schema). Everything that requires judgment about what a specific tool's output *means* is the agentic bridge's job. Every boundary resolves to exactly one of **`content | no_verdict | transport`**.
- **No verdict is inferred from silence.** Both Verifier procedures (the short-cycle/semantic procedure and the **Stage-1 test-intent pre-pass** your test beads route through) now require **positive** success evidence at the triple AND support level. A degraded/empty/`{triples:[]}` response is an infrastructure **`no_verdict`**, never a fabricated reject and never a false-converge. This is the exact path that looped you.
- **A `no_verdict` never loops, crashes, or silent-greens, and is resumable.** It surfaces on a finite infrastructure-recovery axis (a bounded counter, precedence `livelock > no_verdict > budget`, excluded from livelock reject-observations) and ends in a **legible, resumable `paused_infrastructure`** pause (reuses the freeze / `dusk implement --resume <bead-id>` seam). It never burns content-iteration budget and never re-drafts correct code.
- **The silent green is closed (the other honesty dual).** A Stage-2 `decision:"fail"` now blocks the commit and re-enters Step 4 (the never-consumed test `decision` is consumed); a degraded test run that does not yield Dusk's own result schema is `no_verdict`, never a green commit.
- **No opaque-output boundary can crash the run.** Subprocess capture is non-throwing (`spawnSync`); every parse over opaque output is guarded; a stray sync throw surfaces as a loud, legible `internal_error` — never an `exit 1` stack trace. A genuine programming bug still fails loud (the honesty bar — nothing is swallowed).

Net: a degraded model/test boundary under load now surfaces a bounded, legible, resumable signal — the build keeps its footing instead of looping on correct code.

---

## 1. First: point the POC at the fixed dusk (do not skip)

The POC runs the dusk CLI (`dusk implement`, the gate, the verifier, the test runner). To get the D.34 behavior you MUST be running the **current** dusk build:

1. In the dusk monorepo: confirm `main` is at the D.34-archived state (`openspec/changes/archive/2026-06-17-boundary-outcome-handling/` exists; `openspec/specs/boundary-outcome-handling/spec.md` exists) and **`pnpm build` + `pnpm typecheck` + `pnpm test` are green**.
2. Ensure the POC's `dusk` binary/link resolves to *this* freshly-built dusk (re-link / re-install if the POC consumes a built or linked dusk). If the POC runs an older dusk, a degraded Verifier under load will still loop — verify before building.
3. Sanity check (optional, zero-model): the regression suites prove you're on the fixed dusk — `packages/core/schema/src/{boundaryOutcome,testRunResult}.test.ts`, `packages/runtime/verifier/src/procedure.test.ts` (the "positive completeness" block), `packages/runtime/benchmark/src/testPrepass.test.ts` (the "positive completeness" block), `packages/runtime/short-cycle/src/loop.test.ts` (the "D.34 … no_verdict outcome" test), `packages/runtime/long-cycle/src/longCycle.test.ts` (the "no_verdict confirmation" test), `packages/runtime/livelock-detection/src/livelock.test.ts` (the "no_verdict beats budget" test), and `packages/runtime/orchestrator/src/implement.test.ts` (the "Dual A — finite infrastructure axis" test).

---

## 2. REQUIRED project-side task: the test-result adapter (decision ①)

**This is the one piece D.34 deliberately left on the project side** — it is the project's tech surface, not dusk's. After D.34, the dusk Test Runner core reads **only Dusk's own result schema** (`DuskTestRunResult`, in `@dusk/core-schema`) — it no longer parses vitest's JSON vocabulary. When that schema is absent, the **agentic bridge** reads the raw output, but by the asymmetry it can only ever resolve to a `fail` or a `no_verdict` — **it can NEVER mint a `pass`** (a content pass requires Dusk's own result schema). So **without the adapter, a passing suite resolves to `no_verdict`** and the test bead pauses on the infrastructure axis — you will not get a green commit until the adapter is configured. (A genuinely failing suite the agent *can* catch and re-enter Step 4, even without the adapter — but you still need the adapter to confirm a pass.) **Configure the adapter.**

Configure a **project-side test reporter** (a thin vitest reporter for this POC) that emits, on stdout, Dusk's own result schema:

```jsonc
{
  "schema_version": 1,
  "passed": <int>,                 // count of passed tests
  "failed": <int>,                 // count of failed tests
  "not_run": <int>,                // skipped/todo/pending (NEVER counted as fail)
  "completed": <bool>,             // the ran-to-completion assertion — false if the run was
                                   // truncated/OOM-killed mid-flight (so a partial failed:0 is
                                   // read as no_verdict, NEVER a silent green)
  "cases": [{ "name": "<test name>", "outcome": "passed"|"failed"|"not_run", "duration_ms": <number> }]
}
```

Wire it via the foundation intent's test command (the project's tech surface — e.g. `vitest run --reporter=<dusk-result-reporter>`). The mechanical floor the dusk core applies to this schema: `failed>0 ⇒ fail`; `passed>0 ∧ failed==0 ∧ completed ⇒ pass`; otherwise (absent / unparseable / `completed:false` / only non-run) ⇒ `no_verdict`. This adapter is **project source you author via the normal whitelisted channel** (it is part of the POC's build, not hand-edited application logic to route around a gap) — it is the analogue of how your *code* is decorated to map onto Dusk's *intent* schema. **Build/configure this adapter before expecting a Stage-2 content verdict.**

---

## 3. Reset to the last checkpoint before the pause

Confirm the POC repo (`dusk-notifications-poc`) is at the clean pre-pause checkpoint (the foundation + `app/bootstrap` layer as it stood before the looping `bd_…005`/`bd_…006` run) and confirm a clean tree before resuming. The preserved worktree(s) and `.ia/observability/traces.jsonl` were the evidence for the corrected diagnosis; they can be discarded once you've confirmed the checkpoint, or reused if their WIP is still correct under the current dusk.

---

## 4. Resume: build the bootstrap-tree layer

Continue the POC build from the bootstrap-tree layer with the D.34 behavior now in force:

- Run `dusk implement` for the bootstrap beads as your plan requires. The D.32 test-pyramid routing is still in force; the udc sidecar (D.28), the structural channel (D.29–D.31), and model-call failure handling (D.33) are all landed.
- If a Verifier / pre-pass / test boundary ever degrades under load, expect a **bounded, legible `no_verdict`** that re-tries finitely and then pauses as **`paused_infrastructure`** (resume via `dusk implement --resume <bead-id>`) — **not** a 21-iter loop on correct code and **not** a crash. If you ever still see a bead loop re-drafting correct code, the POC is running an old dusk (go back to §1).
- If you see Stage-2 beads pausing on `no_verdict` and never producing a `pass`/`fail`, the **test-result adapter (§2) is not configured** — do §2 first.
- Zero hand-written application code still holds — resolve any surfaced failure through the whitelisted channels (clearer task, re-run, configure the adapter), never by hand-editing app/test code.

---

## 5. If the build surfaces another dusk gap

This is the §6.5 corrective loop you've been running (D.28 → D.29/30/31 → D.32 → D.33 → D.34). If the greenfield load surfaces another genuine dusk-side gap, **pause this POC session and hand it back** as an investigation handoff (observed facts + citations, no prescribed fix) — the orchestrator session convenes the arch board, resolves it from first principles, lands the corrective as its own v1.x change, and hands you a resume prompt like this one. Do NOT fix dusk from the POC session, and do NOT hand-write application code to route around a gap.

---

## 6. Guardrails (unchanged — from the Phase-6 brief)

- **Zero hand-written application code** — every line of app source (incl. test bodies) via `dusk_author` + `dusk_implement`, trailer-audited. The §2 test-result adapter is project build configuration authored through the normal channel, not a route-around hack.
- **Two repos:** you build the POC repo; dusk stays read-only from your side (correctives go back through the orchestrator, §5).
- **Full mission, constraints, and the trailer/coverage axes:** `docs/rfcs/001-mvp-rfc/phase-6-greenfield-poc-next-prompt.md`.

**Confirm you're on the D.34 dusk. Configure the test-result adapter (§2). Reset clean. Build the bootstrap tree. A degraded boundary now surfaces a bounded, resumable `no_verdict` — it doesn't loop, crash, or silent-green; a real failure still re-drafts. Flakes are mitigated, not tolerated.**
