# Handoff — Observed Gap: `error_max_turns` misclassified as transport → fatal run crash (Phase 6 POC)

## How to use this document

This is an **investigation handoff**, not a design or a fix — same contract as
`test-pyramid-channel-gap-handoff.md`. It records an **observed crash** and its
mechanism with citations, separates facts from inferences, and lists the design
questions as **open**, with **no prescribed fix**, so a fresh session resolves it
from first principles. Verify each cited fact independently. The POC build that
surfaced this was resumed after D.32 and is paused again pending resolution.

---

## 0. Context + state

**Dusk** (recap): authors write intents (YAML triples); code is decorated; a
**Verifier** judges; an **Engineer** (`claude --print` agent) drafts in a git
worktree; a **short cycle** re-drafts; the whole thing runs as `dusk implement`.
Model calls reach the ambient `claude` CLI through `claudeCodeModelClient`. Real
model-call legs are wrapped by `withTransportRetry` (a pre-registered amendment:
a *transport* failure — model-call plumbing, never content — may be retried once;
two transport deaths fail the leg).

**Recently landed (context):** RFC App. D.26 resolved an analogous problem on a
**different** path — an Engineer **wall-clock timeout** was wrongly transport-
classified and cold-retried to death; the fix was salvage-and-continue on the
Engineer spawn. D.29–D.32 are the structural/test-routing decisions. This gap is
on the **model-client `error_max_turns`** path, which D.26 did not touch.

**State at handoff:**
- POC repo (`dusk-notifications-poc`) `main` is at `ceaeef5` — **clean**; the
  crashed run committed beads only to its worktree branch and **died before
  merging to main**.
- The crashed run's worktree `bd_20260616142011006` (branch
  `dusk/bd_20260616142011006`, tip `70dadf6`) is **left in place as evidence**
  (it contains the WIP: foundation reconcile + the `app/bootstrap` tree with
  D.32-correct test decorations). `.ia/observability/traces.jsonl` shows the
  crashed run (incl. an earlier, separate transport blip — see §4).
- **No `dusk` code was changed.**

---

## 1. Observation (the crash — raw facts)

`dusk implement` (scoped to `app/bootstrap/response-envelope` + its unit-tests)
**exited 1** mid-run with an uncaught `TransportLegFailure`. The crash output
(captured) is, verbatim in the essential part:

```
TransportLegFailure: transport leg failure: two transport-classified deaths on the same observation
  ( Error: claude CLI exited 1:  {"type":"result","subtype":"error_max_turns","duration_ms":28016,
      "num_turns":4,"stop_reason":"tool_use","output_tokens":1091, ...} ;
    Error: claude CLI exited 1:  {"type":"result","subtype":"error_max_turns","duration_ms":26754,
      "num_turns":4,"stop_reason":"tool_use","output_tokens":1079, ...} )
    at withTransportRetry (.../runtime/benchmark/dist/transportRetry.js:33)
    at async Object.taskRunner (.../cli/dist/implement.js:331)
    at async spawnSubAgent (.../runtime/orchestrator/dist/spawn.js:102)
    at async runShortCycle (.../runtime/short-cycle/dist/loop.js:140)
    at async processBead (.../runtime/orchestrator/dist/stateMachine.js:163)
    at async runImplement (.../runtime/orchestrator/dist/stateMachine.js:119)
    at async runImplementCli (.../cli/dist/implement.js:422)
  attempts: [ <both errors, each surfaced at .../runtime/verifier/dist/modelClient.js:70> ]
```

Facts to note (not yet interpreted):
- Both attempts are `subtype: "error_max_turns"`, `num_turns: 4`,
  `stop_reason: "tool_use"`, with **non-zero `output_tokens`** (~1091 / ~1079)
  and cache reads — i.e. the spawn **ran and produced output**; this is **not** a
  0-token/no-response blip.
- Both attempts surface at `runtime/verifier/dist/modelClient.js:70` — the
  ambient `claude` CLI model client (used by the Verifier and the Stage-1
  test-body pre-pass), **not** the Engineer file-writing spawn.
- The two attempts are the first call and its one cold retry; both died the same
  way → `TransportLegFailure` → propagated uncaught → process exit 1.

---

## 2. Mechanism (cited — verify independently)

1. **The model-client spawn and its turn cap.**
   `packages/runtime/verifier/src/modelClient.ts`:
   - `DISABLED_TOOLS = ["Bash","Edit","Write","Read","Glob","Grep","Task","WebFetch","WebSearch"]` (line 90).
   - The `claudeCodeModelClient` completion spawns (lines ~138-144):
     ```
     // --max-turns 3: a stray tool ATTEMPT (denied below) must not hard-fail
     const args = ["--print", "--output-format", "json", "--model", model, "--max-turns", "3"];
     args.push("--system-prompt", system ? `${system}\n\n${noTools}` : noTools);
     args.push("--disallowed-tools", ...DISABLED_TOOLS);
     ```
   - `runClaude` (line ~92) spawns the child and, on non-zero exit, **rejects
     with `"claude CLI exited N: <stdout>"`**.
   - So a call that exhausts `--max-turns 3` returns `error_max_turns` (exit 1) →
     `runClaude` rejects with `"claude CLI exited 1: {…error_max_turns…}"`.

2. **Transport classification.**
   `packages/test-harness/src/transportError.ts`:
   - `const TRANSPORT_MESSAGE_RE = /claude CLI (timed out|exited)/` (line ~22).
   - `isTransportError(error)` returns true when the message matches that regex
     (line ~24-29). The file's own doc says a transport error is "the ambient
     `claude` CLI … **exiting non-zero**" — i.e. **any** non-zero CLI exit,
     including `error_max_turns`, matches.

3. **Retry-to-death.**
   `packages/runtime/benchmark/src/transportRetry.ts:25-37`:
   - `withTransportRetry` runs `observe()`; on a transport error it retries once;
     if the retry is also a transport error it throws `TransportLegFailure`
     (fatal). Comment: "two transport deaths on the same observation fail the leg
     outright."

4. **Propagation.** The thrown `TransportLegFailure` is **not caught** between
   `withTransportRetry` and `runImplement` (stack in §1), so it crashes the whole
   `dusk implement` process (exit 1). No bead is merged; the run does not
   salvage or continue.

**Joined:** the model call exhausted `--max-turns 3` → `error_max_turns` (exit 1)
→ message matches `/claude CLI (… |exited)/` → classified transport → cold-retried
→ the identical call reproduced `error_max_turns` → second transport death →
`TransportLegFailure` → uncaught → run dies.

---

## 3. The two facets — resolve from first principles (NO assumptions, NO prescribed fix)

These are independent; a solution may address one, the other, or both. Neither
is recommended here.

**Facet A — Why did the model call exhaust `--max-turns 3`?**
A Verifier / Stage-1 pre-pass completion is expected to return the requested JSON
in effectively one shot. This one reported `stop_reason: "tool_use"` across 4
turns — the model **attempted tools** (which are `--disallowed-tools`) and ran out
of turns instead of answering. Inputs to examine (as inputs, not conclusions):
the exact system prompt / task that call carried (Verifier vs. test-body
pre-pass — note the pre-pass prompt instructs "Answer only with the requested
JSON"); whether the model attempts tools despite `--disallowed-tools` + the
no-tools system suffix; whether `--max-turns 3` (designed to tolerate **one**
stray attempt) is the right cap; whether this is model-/environment-specific or
systematic. **Not established:** the causal reason the model looped on tool
attempts.

**Facet B — Should `error_max_turns` be transport-classified, cold-retried, and
fatal?**
`error_max_turns` is a **deterministic** function of (task + cap): the cold retry
reproduced it exactly (both `num_turns: 4`). The transport model assumes a
non-zero CLI exit is **transient plumbing** noise that a retry might clear
(`transportError.ts` doc), but a turn-limit exit is **content/limit-shaped**, not
plumbing — retrying the identical call cannot help, and the second death makes it
**fatal to the entire run**. This is structurally the **same lesson as RFC App.
D.26** (a deterministic wall-clock timeout was wrongly transport-classified +
cold-retried + fatal), which D.26 resolved for the **Engineer** path via
salvage-and-continue — but the **model-client `error_max_turns`** path was not
covered. **Open:** whether the same principle should extend here, and if so how
(e.g. distinguish `error_max_turns`/limit exits from genuine transport in
`isTransportError`; handle a turn-limit exit distinctly; adjust the cap/tool
posture so the call can't burn turns; make the leg non-fatal / surface a real
verdict-level failure instead of a crash). Pick from first principles; do not
assume the D.26 mechanism transfers unchanged.

---

## 4. Earlier, separate transport blip (context — may be a confound, not the crash)

Earlier in the **same** run, an **Engineer** spawn returned **0 tokens over a
15-minute wall clock** (`latency_ms: 900012`, `completion_tokens: 0`,
`cost_usd: 0`) — a genuine transport blip. That path behaved **correctly**: the
D.26 wall-clock backstop salvaged and the short cycle continued (the run did not
die there). It is a **different** path (Engineer salvage — worked) from the crash
(model-client `error_max_turns` — fatal). It is recorded because it shows the
environment exhibited `claude`-CLI flakiness during this run, which may be a
confound for Facet A (is the tool-looping environment-specific?). The
relationship between the two, if any, is **not established**.

---

## 5. Evidence map (independently verifiable)

- `packages/runtime/benchmark/src/transportRetry.ts:25-37` — `withTransportRetry`,
  `TransportLegFailure`.
- `packages/test-harness/src/transportError.ts:~22-29` —
  `TRANSPORT_MESSAGE_RE = /claude CLI (timed out|exited)/`, `isTransportError`.
- `packages/runtime/verifier/src/modelClient.ts:90` (`DISABLED_TOOLS`),
  `:~92` (`runClaude` reject string), `:~138-144` (the `--max-turns 3` spawn).
- Crash stack (§1): `cli/dist/implement.js:331` (taskRunner) → `spawn.js:102` →
  `short-cycle/loop.js:140` → `stateMachine.js:163` / `:119`.
- RFC App. D.26 (`docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md`) — the
  analogous wall-clock case + its salvage resolution.
- The full crash output is in the build's task output (captured this session).

---

## 6. Reproduction

- **Unit-level (Facet B):** call `withTransportRetry(observe)` where `observe()`
  rejects twice with `new Error('claude CLI exited 1: {"subtype":"error_max_turns",…}')`;
  confirm it throws `TransportLegFailure` (fatal). Confirm
  `isTransportError(new Error('claude CLI exited 1: …'))` is `true`.
- **End-to-end (Facet A):** run a Verifier / Stage-1 pre-pass model call under an
  environment where the model attempts a disallowed tool, and observe whether it
  exhausts `--max-turns 3` → `error_max_turns`.

---

## 7. State left by this session

- POC `main` at `ceaeef5` (clean; nothing merged — the run crashed pre-merge).
- Crashed worktree `bd_20260616142011006` (branch tip `70dadf6`) **preserved** as
  evidence (foundation reconcile + `app/bootstrap` tree, D.32-correct
  decorations). `.ia/observability/traces.jsonl` shows the crashed run.
- **No `dusk` change made.** Before the crash, **D.32 was validated live**: the
  Engineer decorated all 5 test files with `@intent-test-file` (5) + `@intent-test`
  (16) and **zero** `@intent`/`@intent-support` misuse — so this crash is in the
  model-call error-handling path, **not** the D.29–D.32 logic.
- The POC build is paused at the bootstrap-tree layer pending this gap's
  resolution.
