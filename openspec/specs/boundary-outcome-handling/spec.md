# boundary-outcome-handling Specification

## Purpose
TBD - created by archiving change boundary-outcome-handling. Update Purpose after archive.
## Requirements
### Requirement: Every boundary crossing resolves to exactly one of content, no_verdict, or transport

Every model-call leg and every opaque-tool-output boundary SHALL resolve, via **one** classifier vocabulary living in the `@dusk/core-schema` leaf, to exactly one of: **`content`** (a Dusk-schema-valid AND content-complete verdict — the only outcome that may drive re-draft / commit), **`no_verdict`** (empty / unparseable / incomplete / deterministic-limit / tool-infrastructure — a distinct recovery axis), or **`transport`** (call-plumbing — retried once, then escalating to `no_verdict`). The classifier SHALL be a gate every boundary routes through (no per-package re-implementation, R2). The outcome union SHALL be an internal TS discriminated union, NOT a persisted Zod schema; only the persisted pieces (the `no_verdict` reason detail, the error kind, the bead status) are Zod. The deterministic core SHALL branch only on (a) Dusk's own timeout firing and (b) whether bytes parse into Dusk's own schema; it SHALL NOT branch on any toolchain-minted meaning (an exit code as verdict, "output produced" as success, a tool's status vocabulary). (RFC §1.2.1, App. D.34; R1–R5; design D1.)

#### Scenario: A degraded boundary output is classified no_verdict, not content

- **WHEN** a boundary returns empty, unparseable, or incomplete output that does not yield a Dusk-schema-valid, content-complete verdict
- **THEN** the classifier resolves it to `no_verdict`, never to a content `fail` and never to a content `pass`
- **AND** the outcome routes to the infrastructure-recovery axis, not the content path

#### Scenario: The core does not branch on a tool's exit code as a verdict

- **WHEN** a Stage-2 run exits non-zero (which could be a `137` OOM, a `1` assertion failure, a `0`-with-zero-tests, or a `127` missing-binary — indistinguishable at the exit-code layer)
- **THEN** the core does NOT read the exit code as pass/fail; it captures only `{command, exitCode, stdout, stderr, timedOut}` and resolves the run by whether the output parses into Dusk's own result schema
- **AND** interpretation of schema-absent raw output is delegated to the agentic bridge, never hard-coded in the core

### Requirement: Positive success evidence is required — no verdict is inferred from silence

No control-flow decision SHALL be derived from the *absence* of a negative signal. **Every** verifier procedure that maps a model answer to a verdict — the semantic/short-cycle procedure AND the Stage-1 test-intent pre-pass — SHALL apply a **positive completeness check at both the triple and the support level**: every triple in scope MUST have a matching answer entry and every support MUST have a matching entry. A missing or degraded unit SHALL resolve to `no_verdict` (incomplete), never to a fabricated `fail` (no `?? false`) and never to a fabricated soft-fail (no `?? "vague"`). A parseable-but-empty response (e.g. `{triples:[]}`) under a non-empty scoped triple set SHALL resolve to `no_verdict`, never converge as a clean accept. The agentic bridge's own parse SHALL itself be guarded: a non-parseable or empty bridge response resolves to `no_verdict`, never silently to `fail` and never to `pass`. (RFC App. D.34; R8; design D2; the confirmed live trigger.)

#### Scenario: A degraded empty verdict does not falsely converge

- **WHEN** the Verifier model returns a degraded/empty response (0-token, or parseable-empty `{triples:[]}`) while the scoped intent has one or more triples
- **THEN** the procedure resolves the boundary to `no_verdict` (incomplete), not a verdict with an empty failing set
- **AND** the short cycle does NOT declare convergence and does NOT advance the bead as if the triples passed

#### Scenario: A missing support entry is not coerced to a definite verdict

- **WHEN** the model answer omits an entry for a scoped support id
- **THEN** the completeness check fails at the support level and the boundary resolves to `no_verdict`
- **AND** no `"vague"` (or any) support verdict is fabricated from the absence

### Requirement: A no_verdict never drives a futile loop and never consumes content-iteration budget

A `no_verdict` (infrastructure) outcome SHALL NOT be presented as a content fail and SHALL NOT consume the short cycle's content-iteration budget. The three sites that previously minted a `recoverable:false` failure from an empty/degraded verdict (the short-cycle verdict guard, the Stage-1 pre-pass, the long-cycle verdict guard) SHALL instead route empty/degraded → `infrastructure_no_verdict`. Because nothing downstream consumes the `recoverable` flag on these return paths, the short cycle and the Test Runner SHALL each expose a distinct `no_verdict` outcome kind (a peer to `budget_exhausted`) that the orchestrator routes to the infrastructure-recovery axis. (RFC App. D.34; R6, R10; design D5.)

#### Scenario: Repeated empty verifier responses do not re-draft correct code

- **WHEN** the short-cycle Verifier returns an empty/degraded outcome on an otherwise-correct draft
- **THEN** the short cycle returns a `no_verdict` outcome (the infrastructure axis), not a content reject
- **AND** the Engineer is NOT asked to re-draft and no content iteration is consumed for the degraded call

#### Scenario: The empty-verdict failure is not downgraded to a terminal recoverable:false

- **WHEN** an empty/degraded verdict reaches the short-cycle, Stage-1 pre-pass, or long-cycle verdict guard
- **THEN** it is classified `infrastructure_no_verdict` on the finite recovery axis
- **AND** it is NOT returned as a terminal `recoverable:false` error that aborts the run

### Requirement: A genuine content failure still drives re-draft and still blocks commit

A content-complete `fail` SHALL drive re-draft, and a content-complete Stage-2 `decision:"fail"` SHALL block commit. The orchestrator SHALL consume the Stage-2 `TestVerdict.decision` (today discarded): the Test Runner classifies a content `decision:"fail"` as a `reenter_step4` outcome so the orchestrator routes it through the existing livelock-observation block — re-drafting and blocking commit with no new unbounded loop — and classifies a `no_verdict` as the distinct infrastructure outcome. The core SHALL NOT report green on anything that is not a content `pass`. (RFC App. D.34; R7; design D4.)

#### Scenario: A Stage-2 fail blocks the commit

- **WHEN** the Test Runner yields a Stage-2 `TestVerdict` with `decision:"fail"`
- **THEN** the bead re-enters Step 4 through the existing livelock-observation path and the commit is NOT made
- **AND** no green summary is emitted for that bead

#### Scenario: A content focal-verdict fail still re-drafts

- **WHEN** the short-cycle Verifier returns a content-complete verdict with a `focal_verdict:"fail"` triple
- **THEN** the short cycle drives a re-draft (unchanged content behavior)
- **AND** the `no_verdict` routing does not capture this genuine content failure

### Requirement: The Stage-2 mechanical floor reads only Dusk's own result schema

The Test Runner core SHALL determine a Stage-2 content verdict only by reading **Dusk's own result schema** (emitted by a project-side adapter/reporter — the project's tech surface), never by parsing a toolchain's vocabulary. The floor SHALL be: `failed>0 ⇒ content fail`; `passed>0 ∧ failed==0 ∧ completed ⇒ content pass`; a non-run case (skipped/todo/pending) counts as neither pass nor fail. A result that is absent, unparseable, or whose ran-to-completion assertion is false (e.g. an OOM/SIGKILL-truncated `failed:0`, or Dusk's own timeout fired) SHALL resolve to `no_verdict`, never `pass`. The agentic bridge interprets schema-absent raw output and may push only toward `no_verdict` or `fail` — it SHALL NEVER downgrade a Dusk-schema assertion failure to a flake, and SHALL NEVER manufacture a green. (RFC §3.4, App. D.34; R4, R5, R11; design D3.)

#### Scenario: A truncated zero-failure result is not read as a pass

- **WHEN** Dusk's own result schema is present with `failed:0` but its `completed` ran-to-completion assertion is false (the run was OOM-killed or Dusk's timeout fired mid-run)
- **THEN** the floor resolves the run to `no_verdict`, not `pass`
- **AND** no commit is made on the strength of an absence of recorded failures

#### Scenario: A non-run status is not coerced to a failure

- **WHEN** a mapped test is `skipped`/`todo`/`pending` (non-run) rather than passed or failed
- **THEN** the Dusk-schema reader treats it as neither pass nor fail (it does not satisfy a triple, and it is not a content `fail`)
- **AND** a suite that produced only non-run results resolves to `no_verdict`, not a fabricated `fail` and not a silent `pass`

#### Scenario: The agentic bridge interprets schema-absent raw output and can only push toward fail or no_verdict

- **WHEN** a Stage-2 run does not yield Dusk's own result schema and Dusk's own timeout did not fire
- **THEN** the agentic bridge interprets the raw output and may resolve it ONLY to a content `fail` (re-draft + block commit) or `no_verdict` — it can NEVER resolve to `pass` (a pass requires Dusk's own result schema; the asymmetry is enforced mechanically so a model "pass"/garbage/degraded response resolves to `no_verdict`)
- **AND** when Dusk's own timeout fired, the run is `no_verdict` WITHOUT invoking the bridge (a killed run is definitively infrastructure)

### Requirement: No non-content outcome terminates the process via an uncaught throw

Every opaque-output boundary SHALL be guarded so that no `no_verdict`/`transport` outcome crashes the run. Subprocess invocation SHALL use a non-throwing capture (a non-zero exit is data); every `JSON.parse` over opaque output SHALL be guarded and resolve to `no_verdict` on failure; and the orchestrator's per-bead pipeline SHALL surface any synchronous throw as a legible `DuskError` rather than an `exit 1` stack trace. The guard SHALL remain honest: a genuine programming error (e.g. `TypeError`) is surfaced loud as `internal_error`, NEVER relabelled as a benign `no_verdict` or content outcome. (RFC App. D.34; R9; design D6.)

#### Scenario: A subprocess crash is captured as data, not thrown

- **WHEN** the Stage-2 subprocess exits non-zero or emits malformed output
- **THEN** the runner captures `{command, exitCode, stdout, stderr, timedOut}` without throwing, and an unparseable result resolves to `no_verdict`
- **AND** the run does not terminate with an uncaught exception

#### Scenario: A programming bug still fails loud

- **WHEN** a synchronous `TypeError` (a genuine programming bug) is thrown inside the per-bead pipeline
- **THEN** it is surfaced as a loud `internal_error`, not swallowed into a `no_verdict` or a content outcome
- **AND** no model-call/infrastructure failure signal is fabricated from it

### Requirement: no_verdict surfaces on a finite, legible, resumable recovery axis

A `no_verdict` outcome SHALL surface on a recovery axis with a **finite** retry counter and a terminal **legible, resumable** pause (`paused_infrastructure`). The tick precedence SHALL be `livelock > no_verdict > budget`. `no_verdict` iterations SHALL be **excluded from livelock reject-observations** so infrastructure noise does not trip the consecutive-reject detector; the detector's consecutiveness SHALL be evaluated over the content-observation sequence so an interleaved `no_verdict` is transparent (it neither fills nor resets the window) and a genuine livelock still trips. The pause SHALL be resumable through the existing freeze/resume seam (no new resolve verb), and `paused_infrastructure` SHALL be a recognized bead status. (RFC App. D.34; R7a, R10; design D7.)

#### Scenario: Exhausting the finite counter pauses legibly and resumably

- **WHEN** the configured number of `no_verdict` outcomes is reached for the bead (a per-bead total — a re-convergence on the same unchanged code is not progress that resets it, so a downstream infra loop is still bounded)
- **THEN** the bead pauses as `paused_infrastructure` with a legible reason and a written resume record
- **AND** a subsequent `--resume` re-enters the bead's pipeline from the frozen iteration

#### Scenario: Infrastructure noise does not trip the livelock detector, but a real livelock still does

- **WHEN** `no_verdict` iterations are interleaved with content reject-observations
- **THEN** the `no_verdict` iterations are excluded from the reject-observations and do not advance the consecutive-reject count
- **AND** three consecutive *content* rejects still trip the livelock detector (precedence gives livelock over no_verdict)

### Requirement: A no_verdict long-cycle confirmation is neither a confirming reject nor a flaky dismissal

In the long-cycle N=2 confirmation pass, a `no_verdict` confirmation spawn SHALL be counted as neither a confirming reject nor a flaky dismissal. The confirming-reject tally SHALL be computed over parsed verdicts only; a `no_verdict` confirmation SHALL route the bead to the infrastructure-recovery axis rather than letting the tally fall to zero and dismiss the original reject as flaky. The existing N=2 flaky-dismiss pattern is otherwise preserved. (RFC App. D.34; R7; design D8.)

#### Scenario: A reject followed by no_verdict confirmations is not dismissed as flaky

- **WHEN** the long cycle observes an original `reject` and both confirmation spawns return `no_verdict`
- **THEN** the long cycle does NOT dismiss the original reject as flaky and does NOT emit a clean outcome
- **AND** the bead routes to the infrastructure-recovery axis (pause), preserving "no_verdict ≠ accept"

### Requirement: Both honesty duals hold model-independently

The mechanical guards alone — the positive completeness check, the Dusk-result-schema floor, parse-into-Dusk-schema, the routing tables, the finite counters, and consuming the Stage-2 `decision` — SHALL prevent both silent-green and false-loop regardless of model behavior. The classification, routing, counter, and floor SHALL be zero-model and deterministically testable. The single model-facing element (which raw output the agentic bridge interprets when Dusk's schema is absent) SHALL NOT be relied upon for either honesty dual: the bridge can only push toward `no_verdict`/`fail`, so neither dual depends on the model returning content. (RFC App. D.34; R11; design D3, "Determinism & honesty posture".)

#### Scenario: The duals hold under a fully degraded model

- **WHEN** every model call on a bead returns degraded/empty output (no content ever produced)
- **THEN** the run never silent-greens (no commit without a content `pass`) and never loops re-drafting correct code (degraded calls route to the finite `no_verdict` axis)
- **AND** these properties are verified with scripted doubles and zero real model calls

