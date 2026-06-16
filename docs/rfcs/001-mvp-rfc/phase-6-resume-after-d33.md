# Resume — Phase-6 POC, bootstrap-tree layer (after D.33 landed)

> Paste this into the **existing Phase-6 POC session** to restart the build. The crash that paused you — `dusk implement` dying with an uncaught `TransportLegFailure → exit 1` when a model call hit `error_max_turns` — is **fixed and archived in dusk** (RFC App. D.33, `model-call-failure-handling`). A deterministic model-call failure is no longer a fatal crash; it is classified honestly and surfaced as a returned failure the recovery ladder handles. Your full mission/constraints are unchanged — see `phase-6-greenfield-poc-next-prompt.md` for the complete brief; this file is only the resume delta.

---

## 0. What changed in dusk while you were paused (the unblock)

**D.33 `model-call-failure-handling` is landed + archived** (`openspec/changes/archive/2026-06-16-model-call-failure-handling/`; the `model-call-failure-handling` capability synced to `openspec/specs/`). It closes the exact defect that crashed you — a no-tools JSON model call (the Verifier / Stage-1 test-body pre-pass / a reasoning sub-agent) burned its turn budget attempting tools, exited `error_max_turns`, was **mis-classified as a transport failure**, cold-retried (the identical deterministic failure reproduced), and the second "transport death" threw an **uncaught** `TransportLegFailure` that killed the whole run pre-merge. This was the **D.26 lesson un-applied to the model-call path**. Now, in the dusk you'll build against:

- **A deterministic `error_max_turns` is non-transport and is NOT cold-retried.** The CLI's `error_max_turns` result envelope is tagged at the throw site and classified content/limit-shaped, not plumbing — so it never triggers the pointless retry that manufactured the fatal second death.
- **A model-call failure is SURFACED, never an uncaught crash.** The spawn seam (`spawnSubAgent`) converts a classified model-call failure into a **returned** `verifier_model_call_failed` (verifier/pre-pass) / `task_tool_call_failed` (reasoning) that the short cycle + recovery ladder handle. A run no longer dies with a stack trace on a deterministic model-call failure — it surfaces a legible `implement: <kind> — <message>` and the ladder acts on it. The catch is **narrow**: a genuine programming bug still fails loud (no silent false-recovery).
- **The tool surface is removed at the request (defense-in-depth).** The model client now spawns with `--tools ""` (a zero-tool allowlist) instead of the old, incomplete `--disallowed-tools` denylist, so `tool_use` is structurally impossible in the common case — driving the `error_max_turns`-by-tool-looping rate toward zero. `--max-turns 3` is kept purely as a blast-radius backstop. **This is a rate-improver only; correctness comes entirely from the classify-and-surface guards above** (which hold regardless of model behavior, MCP tools, or future CLI tools).

Net: the model-call error path is now safe. A model call that can't produce a verdict surfaces a real, recoverable signal — the run keeps its footing instead of crashing.

---

## 1. First: point the POC at the fixed dusk (do not skip)

The POC runs the dusk CLI (`dusk implement`, the gate, the verifier). To get the D.33 behavior you MUST be running the **current** dusk build:

1. In the dusk monorepo: confirm `main` is at the D.33-archived state (the model-call-failure-handling change is in `openspec/changes/archive/2026-06-16-model-call-failure-handling/`; `openspec/specs/model-call-failure-handling/` exists) and **`pnpm build` is green**.
2. Ensure the POC's `dusk` binary/link resolves to *this* freshly-built dusk (re-link / re-install if the POC consumes a built or linked dusk). If the POC runs an older dusk, a model-call `error_max_turns` will still crash the run — verify before building.
3. Sanity check (optional, zero-model): the regression tests `packages/core/schema/src/modelCallError.test.ts`, `packages/runtime/orchestrator/src/spawn.test.ts` (the "D.33 — a model-call failure is surfaced" block), and `packages/runtime/short-cycle/src/loop.test.ts` (the bead-orchestrator-tick block) all pass — proof you're on the fixed dusk.

---

## 2. Reset to the last checkpoint before the crash

The crashed run committed beads only to its worktree branch and **died before merging to main** — POC `main` was left clean at `ceaeef5` (nothing merged). The crashed worktree `bd_20260616142011006` (branch tip `70dadf6`) was preserved as evidence (foundation reconcile + the `app/bootstrap` tree with D.32-correct test decorations). Reset/confirm the POC repo (`dusk-notifications-poc`) to the clean pre-crash checkpoint — the foundation + `app/bootstrap` layer as it stood before the killed `response-envelope` run — and confirm a clean tree before resuming. (The preserved worktree can be discarded once you've confirmed the checkpoint, or reused if its WIP is still correct under the current dusk.)

---

## 3. Resume: build the bootstrap-tree layer

Continue the POC build from the bootstrap-tree layer (`app/bootstrap/response-envelope` + its `unit-tests`, then onward) with the D.33 behavior now in force:

- Run `dusk implement` for the bootstrap beads as your plan requires. The D.32 test-pyramid routing is still in force (test intents route by suffix; the Engineer is taught the test markers), and now a model-call hiccup mid-run no longer kills it.
- If a Verifier / pre-pass / reasoning model call ever fails (e.g. a genuine transport blip's two deaths, or a residual `error_max_turns`), expect a **returned, legible failure** the short cycle / recovery ladder acts on (re-draft, freeze, or escalate) — **not** an `exit 1` crash. If you ever still see an uncaught `TransportLegFailure` crash, that means the POC is running an old dusk (go back to §1).
- Zero hand-written application code still holds — resolve any surfaced failure through the whitelisted channels (clearer task, re-run), never by hand-editing app/test code.

---

## 4. If the build surfaces another dusk gap

This is the §6.5 corrective loop you've been running (D.29 → D.30 → D.31 → D.32 → D.33). If the greenfield load surfaces another genuine dusk-side gap, **pause this POC session and hand it back** as an investigation handoff (observed facts + citations, no prescribed fix) — the orchestrator session convenes the arch board, resolves it from first principles, lands the corrective as its own v1.x change, and hands you a resume prompt like this one. Do NOT fix dusk from the POC session, and do NOT hand-write application code to route around a gap.

---

## 5. Guardrails (unchanged — from the Phase-6 brief)

- **Zero hand-written application code** — every line of app source (incl. test bodies) via `dusk_author` + `dusk_implement`, trailer-audited.
- **Two repos:** you build the POC repo; dusk stays read-only from your side (correctives go back through the orchestrator, §4).
- **Full mission, constraints, and the trailer/coverage axes:** `docs/rfcs/001-mvp-rfc/phase-6-greenfield-poc-next-prompt.md`. The udc sidecar (D.28), the structural channel (D.29–D.31), test-pyramid routing (D.32), and now model-call failure handling (D.33) are all landed.

**Reset clean. Confirm you're on the D.33 dusk. Build the bootstrap tree. A model-call failure now surfaces, it doesn't crash — let the ladder handle it.**
