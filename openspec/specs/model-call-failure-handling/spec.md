# model-call-failure-handling Specification

## Purpose
A deterministic, content/limit-shaped model-call failure (`error_max_turns` and siblings) is classified **non-transport** (not cold-retried) and **surfaced as a returned failure** the short cycle + recovery ladder handle — never an uncaught fatal crash, never a silent false-recovery. Classification is structural, made at the throw site where the CLI result envelope is in hand. The spawn-seam catch is narrow (programming errors still propagate loud). Tool suppression via `--tools ""` is a defense-in-depth rate-improver, never a correctness guarantee. (RFC App. D.33, generalizing App. D.26's transport-classification lesson from the Engineer path to the model-call path; created by archiving change model-call-failure-handling.)

## Requirements

### Requirement: A content/limit-shaped model-call exit is classified as non-transport

A non-zero `claude` CLI exit whose stdout carries a well-formed result envelope with an **error subtype** (`error_max_turns` and siblings — i.e. the plumbing succeeded and the model produced an envelope) SHALL be classified as a **non-transport** failure. Classification SHALL be made at the throw site (`runClaude`), where the structured `subtype` is in hand, by tagging the thrown error structurally (a discriminant field) — NOT by extending the `TRANSPORT_MESSAGE_RE` regex over the stringified message. `isTransportError` SHALL return `false` for a so-tagged error, and SHALL continue to return `true` for genuine transport failures (CLI timeout, spawn errno, `SyntaxError` on a malformed/absent envelope). A so-classified non-transport failure SHALL NOT be cold-retried (a deterministic limit failure reproduces identically — retrying is waste). (RFC App. D.33; design D1.)

#### Scenario: error_max_turns is not transport

- **WHEN** `isTransportError` is asked to classify an error thrown for a non-zero CLI exit whose envelope is `{"type":"result","subtype":"error_max_turns",…}` (tagged at the source)
- **THEN** it returns `false` (the failure is content/limit-shaped, not plumbing)
- **AND** `withTransportRetry` does NOT cold-retry it and does NOT raise `TransportLegFailure` for it — it rethrows the single classified error for the spawn seam to handle

#### Scenario: A genuine transport failure is still transport

- **WHEN** `isTransportError` classifies `"claude CLI timed out"`, a Node errno error (e.g. `ENOENT`/`EPIPE`), or a `SyntaxError` from a malformed `--output-format json` envelope
- **THEN** it returns `true` (genuine plumbing — eligible for the single transport retry), exactly as before this change

### Requirement: A classified model-call failure is surfaced as a returned failure, never an uncaught crash

When a model call made through `spawnSubAgent` fails with a **classified model-call/CLI failure** — a genuine `TransportLegFailure` (two transport deaths) OR a content/limit-shaped failure (the tag above) — `spawnSubAgent` SHALL convert the thrown failure into a **returned** failure rather than letting it propagate uncaught: a `verifier_model_call_failed` verdict for the verifier/pre-pass path, and a `task_tool_call_failed` (recoverable) `RuntimeResult` for the reasoning (`taskRunner`) path. The returned failure SHALL flow into the short cycle's existing returned-failure handling and the recovery ladder, producing a legible failure outcome — never an `exit 1` stack trace, and never a silent acceptance. Every short-cycle spawn whose result could now be a surfaced failure SHALL have that result checked — including the **bead-orchestrator tick**, whose `RuntimeResult` is currently discarded; a surfaced failure there SHALL be propagated, never silently dropped. (RFC App. D.33; design D2, D4; "no silent behavior, no fatal crash on a deterministic failure".)

#### Scenario: A thrown model-call failure on the reasoning path becomes a returned failure

- **WHEN** a non-verifier (`taskRunner`) spawn's model call throws a classified model-call failure (e.g. a tagged `error_max_turns`, or a `TransportLegFailure`)
- **THEN** `spawnSubAgent` returns `{ success: false, error: task_tool_call_failed }` (recoverable), not a thrown exception
- **AND** the short cycle propagates it as a returned failure and the run surfaces a legible `implement: <kind> — <message>` outcome rather than crashing with `exit 1`

#### Scenario: A thrown model-call failure on the verifier path becomes a returned verdict failure

- **WHEN** a verifier or Stage-1 test-body pre-pass spawn's model call throws a classified model-call failure
- **THEN** `spawnSubAgent` yields a `verifier_model_call_failed` verdict the recovery ladder routes (via the existing `isDuskError(verdict)` handling), not a thrown exception

#### Scenario: A surfaced failure on the bead-orchestrator tick is not silently dropped

- **WHEN** the short-cycle bead-orchestrator tick (a `taskRunner` spawn whose result is otherwise discarded) has its model call throw a classified model-call failure
- **THEN** the surfaced `{success:false}` is checked and propagated as a returned short-cycle failure — never ignored, leaving the loop to continue as if the tick succeeded

### Requirement: The model-call failure catch is narrow — programming errors propagate loud

The conversion of a thrown model-call failure into a returned failure SHALL be **narrow**: it applies ONLY to classified model-call/CLI failures (transport- or limit-shaped). Any other thrown error — `TypeError`, `RangeError`, assertion failures, a returned `internal_error`, or any unclassified throw — SHALL propagate and fail loud, NEVER be relabelled as a model-call failure. This mirrors the existing rule that "programming errors are never bookkept as model noise". A catch that swallowed an arbitrary throw into a benign "model call failed" (a silent false-recovery) is explicitly forbidden. (RFC App. D.33; design D3.)

#### Scenario: A programming bug is not swallowed

- **WHEN** a model-call caller (`taskRunner` or `verifierFactory`) throws a `TypeError` (a genuine programming bug, not a model-call/CLI failure)
- **THEN** `spawnSubAgent` does NOT convert it to `task_tool_call_failed`/`verifier_model_call_failed` — it propagates the `TypeError` so it fails loud
- **AND** no model-call failure signal is fabricated from a non-model-call error

### Requirement: Tool suppression at the request surface is defense-in-depth, not a correctness guarantee

The model-client spawn SHALL remove the tool surface from the request using a zero-tool allowlist (`--tools ""`) rather than an incomplete denylist (`--disallowed-tools`), so that `tool_use` is structurally impossible in the common case and `error_max_turns`-by-tool-looping is driven toward zero. The `--max-turns` cap SHALL be retained as a blast-radius backstop. This tool-surface change is a **rate-improver only**: it lowers how often the limit is hit but is NEVER relied upon for correctness — correctness is guaranteed by the failure being classified non-transport and surfaced (the requirements above), which holds regardless of model behavior, MCP tools, future CLI tools, or prompt-injected tool attempts. (RFC App. D.33; design D5; reconciles with App. D.26's retention of `--max-turns 3`.)

#### Scenario: tool_use is removed at the request surface

- **WHEN** the model client spawns a no-tools completion
- **THEN** the args use `--tools ""` (zero-tool allowlist), not `--disallowed-tools` (denylist)
- **AND** `--max-turns` is retained as a blast-radius backstop

#### Scenario: Correctness does not rest on tool suppression

- **WHEN** a `tool_use` nonetheless occurs (e.g. via an MCP tool, a future CLI tool, or a prompt-injected attempt) and the call exits `error_max_turns`
- **THEN** the failure is still classified non-transport and still surfaced as a returned failure (never fatal) — the mechanical guards hold independently of the tool-suppression rate-improver
