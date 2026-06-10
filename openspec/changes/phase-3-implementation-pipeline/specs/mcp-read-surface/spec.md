## MODIFIED Requirements

### Requirement: `dusk://beads/active` and `dusk_list_beads` serve populated bead state during an in-flight pipeline

The `dusk://beads/active` resource and its paired `dusk_list_beads` tool — shipped against empty collections in Phase 2 — SHALL now return populated bead summaries during an in-flight `dusk_implement` run, with one entry per active bead carrying `{ id, status, current_step, started_at, branch }`. `status` SHALL reflect the bead's current pipeline state (e.g., `decomposing`, `short_cycle`, `long_cycle`, `test_execution`, `committing`, `merging`, `paused_livelock`, `paused_recovery_ladder`, `cancelled`, `done`). When no pipeline is in flight, the response SHALL be empty (as in Phase 2). (RFC §10.1; **P3-T20** observability; Phase-2 `mcp-read-surface` extension.)

#### Scenario: Active bead appears in the listing with current_step

- **WHEN** a `dusk_implement` run has an active bead currently in the short cycle, and the harness reads `dusk://beads/active` (or calls `dusk_list_beads`)
- **THEN** the response includes one entry for that bead with `status: "short_cycle"`, a populated `current_step`, the branch name `dusk/<bead-id>`, and a non-null `started_at`

#### Scenario: Idle response remains empty (Phase-2 contract held)

- **WHEN** no pipeline has been invoked since server startup
- **THEN** `dusk_list_beads({})` returns `{ beads: [] }`

### Requirement: `dusk://implement-checkpoints` and `dusk_list_implement_checkpoints` enumerate outstanding paused-pipeline checkpoints

The `dusk://implement-checkpoints` resource and its paired `dusk_list_implement_checkpoints` tool SHALL enumerate every checkpoint file present under `.ia/runtime/implement/` with one entry per checkpoint carrying `{ resume_token, original_request, created_at, last_touched_at, unresolved_refs }` per RFC §10.1.1. When no checkpoints exist, the response SHALL be empty. (RFC §10.1.1; design D4; Phase-2 `mcp-read-surface` extension.)

#### Scenario: Outstanding checkpoint appears in the listing

- **WHEN** a `dusk_implement` invocation has paused with `implement_paused_for_authoring` and `dusk_list_implement_checkpoints({})` is called
- **THEN** the response contains one entry whose `resume_token` matches the returned token
- **AND** every field of the entry is populated from the checkpoint file

#### Scenario: Idle response is empty

- **WHEN** no checkpoint files exist under `.ia/runtime/implement/`
- **THEN** `dusk_list_implement_checkpoints({})` returns `{ checkpoints: [] }`

### Requirement: `dusk_inspect` reads consistently against the snapshot during an in-flight run

When `dusk_inspect({scope})` is called during an in-flight `dusk_implement` run, its queries SHALL execute against the session snapshot (§session-snapshot-index), NOT against any bead's in-flight delta. The shape and surface SHALL remain exactly as Phase 2 specified (including `low_confidence_supports[]` from in-run verdicts). (RFC §2.10, §10.1; design D1; Phase-2 `mcp-read-surface` contract.)

#### Scenario: In-flight inspect sees the snapshot, not bead deltas

- **WHEN** a bead has written a new decoration to its worktree mid-run, and the harness calls `dusk_inspect` during the same run
- **THEN** the response does NOT include the bead's in-flight delta decoration
- **AND** the response's intent satisfaction reflects the snapshot's state
- **AND** the response shape matches the Phase-2 `dusk_inspect` contract exactly
