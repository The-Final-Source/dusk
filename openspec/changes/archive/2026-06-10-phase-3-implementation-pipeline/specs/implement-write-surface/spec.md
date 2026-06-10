## ADDED Requirements

### Requirement: `dusk_implement` is the MCP write-surface entry point for the 9-step pipeline

The MCP server SHALL expose `dusk_implement({ request?: string, resume_token?: string, scope_hint?: string[] })` accepting either a fresh request or a `resume_token` (exactly one of the two SHALL be present). The tool SHALL wire the 9-step state machine: Decomposer (§bead-decomposition) → Worktree (§worktree-orchestration) → Short Cycle (§short-cycle) → Long Cycle (§long-cycle) → Test Execution (§test-execution) → Commit (§commit-merge Step 7) → Merge (§commit-merge Step 8) → Return Summary (§commit-merge Step 9). On success the tool SHALL return the Step-9 summary; on failure it SHALL return a `DuskError`. (RFC §6.1–§6.9, §10.1.1.)

#### Scenario: Fresh request walks the full pipeline

- **WHEN** `dusk_implement({ request: "add cursor decoding for paginated lists" })` is called against a repo with pre-authored intents
- **THEN** the pipeline walks Steps 1–9 in order
- **AND** the return value is the Step-9 summary per `commit-merge` (commits[], beads_summary[], …)

#### Scenario: Resume token continues from Step 1

- **WHEN** `dusk_implement({ resume_token })` is called against a paused run
- **THEN** the pipeline reloads the checkpoint via `implement-checkpoint`
- **AND** the Decomposer re-runs the unresolved-ref check
- **AND** if the previously-unresolved intent now resolves, the pipeline proceeds to Step 2
- **AND** the checkpoint is deleted on Step-1 transition (single-use)

#### Scenario: Exactly one of `request` or `resume_token` is required

- **WHEN** `dusk_implement({})` is called with neither field set
- **THEN** the call returns `DuskError { kind: "config_invalid" }` naming the missing field
- **AND** when both fields are set, the call returns `DuskError { kind: "config_invalid" }` naming the conflict

### Requirement: `dusk_cancel` is exposed as a write-surface MCP tool

The MCP server SHALL expose `dusk_cancel({ bead_id?: string, reason: string })` returning `CancelResult` (per §cooperative-cancel). The tool SHALL be available to the harness at any time during an in-flight `dusk_implement` run. (RFC §10.1.2.)

#### Scenario: Cancel mid-run returns a CancelResult

- **WHEN** `dusk_implement` is in-flight and `dusk_cancel({reason: "user abort"})` is called
- **THEN** the cancel tool returns a `CancelResult` per §cooperative-cancel
- **AND** the `dusk_implement` invocation returns its own response according to how far it progressed before the cancel flag was read

### Requirement: `dusk_resolve_livelock` is exposed as a write-surface MCP tool

The MCP server SHALL expose `dusk_resolve_livelock({ bead_id: string, verb: "accept_test_as_is" | "modify_triple" | "escalate", payload?: object })` returning either a success acknowledgment or a `DuskError`. The tool SHALL be available to the harness whenever a `TestVerifierLivelockReport` has been emitted and the bead is awaiting resolution. (RFC §3.4.1.)

#### Scenario: Resolving a livelock resumes the bead

- **WHEN** a bead is paused with a `TestVerifierLivelockReport` and `dusk_resolve_livelock({bead_id, verb})` is called with a valid verb
- **THEN** the bead resumes per the verb's semantics (§livelock-detection)
- **AND** `dusk_implement`'s in-flight invocation continues toward Step 7 or back to Step 4 per the resolution

### Requirement: `/dusk-test` runs the Test Runner standalone on a scope

The MCP server SHALL expose a `/dusk-test` slash command that invokes the Test Runner alone on a given scope without the full pipeline. The command SHALL discover test files via the index, invoke Vitest with the scoped list per §test-execution, and return a `TestVerdict`. Per design D9 of Phase 2 (synthetic bead-id, ephemeral memory), the standalone invocation SHALL use an ephemeral synthetic `bead-id` so it doesn't pollute `.ia/runtime/beads/`. (RFC §10.2; **P3-T27**.)

#### Scenario: Standalone test execution returns a TestVerdict

- **WHEN** `/dusk-test notifications/send/unit-tests` is invoked
- **THEN** the Test Runner discovers test files via the index for `notifications/send/unit-tests`
- **AND** invokes Vitest with the scoped list
- **AND** returns a `TestVerdict` per §test-execution
- **AND** no persistent bead memory is created under `.ia/runtime/beads/` (the synthetic bead-id is ephemeral)
