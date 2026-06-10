## ADDED Requirements

### Requirement: `dusk_cancel` is a cooperative drain — flag set, in-flight Task calls run to completion

`packages/runtime/cancel` SHALL implement `dusk_cancel({ bead_id?, reason })` per RFC §10.1.2. Because Claude Code's Task tool has no documented abort primitive, cancel SHALL be cooperative: set a per-bead (or session-wide when `bead_id` is omitted) cancellation flag; the orchestrator's next tick reads the flag **after** the current Task call returns; **no new Task calls are issued** for the flagged target; in-flight Task calls run to completion and are counted as `in_flight_tasks_drained`. The implementation SHALL NOT attempt to abort an in-flight Task. (RFC §10.1.2; design D9; **P3-T22**.)

#### Scenario: In-flight Task calls complete before cleanup begins

- **WHEN** `dusk_cancel({bead_id})` fires while a Verifier Task call is in flight for that bead
- **THEN** the Task call runs to completion (no abort attempted)
- **AND** the result counts toward `in_flight_tasks_drained` in the `CancelResult`
- **AND** no new Task calls are issued for the cancelled bead after the flag is read

### Requirement: Cleanup proceeds in a fixed order: dialogs → checkpoints → bead memory → worktrees-no-commits

After the drain completes, the orchestrator SHALL run an ordered cleanup pass: (1) delete dialog directories at `.ia/runtime/dialogs/<dialog-id>/` for dialogs associated with the cancelled scope; (2) delete checkpoint files at `.ia/runtime/implement/<resume_token>.json` for the cancelled scope; (3) delete bead memory at `.ia/runtime/beads/<bead-id>/<role>.md` for cancelled beads; (4) `git worktree remove` for cancelled bead branches that contain no commits, and delete the branch. (RFC §10.1.2; design D9.)

#### Scenario: Ordered cleanup occurs after drain

- **WHEN** `dusk_cancel({bead_id})` is called with an active dialog, a checkpoint, bead memory files, and an empty worktree
- **THEN** the cleanup pass deletes the dialog dir first, then the checkpoint, then the bead memory, then `git worktree remove`s the worktree
- **AND** the order is observable in the trace stream (each cleanup step writes an event)

### Requirement: Worktrees with commits are preserved as `partial_commits[]` for user decision

When a cancelled bead's branch contains one or more commits, the branch SHALL NOT be deleted, and the worktree SHALL NOT be removed. Instead, the branch SHALL appear in `CancelResult.cancelled.partial_commits[]` carrying `{ bead_id, branch, commit_sha }` for each commit. The user decides whether to merge or discard the branch later. (RFC §10.1.2; design D9.)

#### Scenario: Worktree with committed work is preserved

- **WHEN** `dusk_cancel({bead_id: B})` fires while B's branch carries an unmerged commit
- **THEN** the branch `dusk/<B>` is NOT deleted
- **AND** the worktree directory is NOT removed
- **AND** `CancelResult.cancelled.partial_commits[]` contains an entry `{ bead_id: B, branch: "dusk/<B>", commit_sha: <sha> }`

### Requirement: Already-merged work is preserved and reported as `already_committed[]`

When a cancelled bead's commit has already been rebased onto `main` (Step 8 already completed for that bead), the commit SHALL NOT be reverted. The entry SHALL appear in `CancelResult.preserved.already_committed[]` carrying `{ bead_id, commit_sha }`. (RFC §10.1.2; design D9.)

#### Scenario: Already-merged work is reported as preserved, not undone

- **WHEN** `dusk_cancel({bead_id: A})` fires after A's commit has already been rebased to `main`
- **THEN** the commit on `main` is NOT reverted
- **AND** `CancelResult.preserved.already_committed[]` contains `{ bead_id: A, commit_sha: <sha-on-main> }`

### Requirement: `CancelResult` shape is frozen per RFC App. A.11

The `CancelResult` shape SHALL be: `{ cancelled: { cancelled_worktrees[], partial_commits[], cancelled_dialogs[], cancelled_checkpoints[], bead_memories_deleted[] }, preserved: { already_committed[], in_flight_tasks_drained }, trace_id, drain_duration_ms }` defined in `@dusk/core-schema`. (RFC App. A.11; design D14.)

#### Scenario: CancelResult parses against the frozen schema

- **WHEN** `dusk_cancel` completes
- **THEN** the returned `CancelResult` parses against the Zod schema in `@dusk/core-schema`
- **AND** every entry partitions correctly into `cancelled` vs `preserved`

### Requirement: `cancellation_already_committed` is informational, not an error

When `dusk_cancel({bead_id})` is called with a `bead_id` whose work has already been fully merged to `main`, the response SHALL be `DuskError { kind: "cancellation_already_committed", recoverable: false }` (informational — "nothing to cancel here") with `CancelResult.preserved.already_committed[]` populated. The presence of this kind SHALL be readable by the harness as a non-error condition. (RFC §10.1.2.)

#### Scenario: Cancel on a fully-merged bead is informational

- **WHEN** `dusk_cancel({bead_id: A})` is called after A is fully merged
- **THEN** the response is `DuskError { kind: "cancellation_already_committed", recoverable: false }`
- **AND** the accompanying state shows A in `preserved.already_committed[]`
