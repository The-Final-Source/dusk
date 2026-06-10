## ADDED Requirements

### Requirement: The `dusk` CLI exposes the Phase-3 write-path commands that mirror the MCP write surface

The `dusk` CLI SHALL gain the following commands alongside the Phase-1 + Phase-2 surface: `dusk implement` (mirrors `dusk_implement` for direct human invocation, primarily for debugging), `dusk implement --resume <bead-id>` (mirrors the resume side of `dusk_implement({resume_token})` and also serves as the resume path for L3-frozen beads per §recovery-ladder), `dusk doctor --cleanup-worktrees` (orphan-worktree reaping per §worktree-orchestration), `dusk doctor --gc-implement-checkpoints` (stale-checkpoint reaping per §implement-checkpoint), and `dusk doctor --gc-dialogs` (stale-dialog reaping). Every new command SHALL support `--help`. (RFC §10.2; Phase-3 CLI surface.)

#### Scenario: `dusk implement <request>` mirrors `dusk_implement`

- **WHEN** `dusk implement "add cursor decoding for paginated lists"` is invoked
- **THEN** the command runs the same 9-step pipeline as the MCP `dusk_implement` tool against the same repo
- **AND** the command prints the Step-9 summary in a human-readable form on success
- **AND** the working tree reflects the produced commits on the bead branches (or `main` after Step 8 completes)

#### Scenario: `dusk implement --resume <bead-id>` resumes an L3-frozen bead

- **WHEN** a bead is L3-frozen (a `freeze-state.md` exists under `.ia/runtime/beads/<bead-id>/`) and `dusk implement --resume <bead-id>` is invoked
- **THEN** the command reloads the frozen state and resumes the bead's Step-4 entry per §recovery-ladder
- **AND** prints the Step-9 summary (or any subsequent error) on completion

#### Scenario: `dusk doctor --cleanup-worktrees` is idempotent

- **WHEN** `dusk doctor --cleanup-worktrees` is invoked twice in sequence on a repo where the first run reaped one orphan
- **THEN** the first run reaps the orphan, prints its path, and exits 0
- **AND** the second run prints no output and exits 0

#### Scenario: `dusk doctor --gc-implement-checkpoints` reaps stale, preserves fresh

- **WHEN** the repo contains one stale checkpoint (>24h since `last_touched_at`) and one fresh checkpoint (<1h), and `dusk doctor --gc-implement-checkpoints` is invoked
- **THEN** the stale checkpoint file is deleted
- **AND** the fresh checkpoint file is preserved
- **AND** the command exits 0

#### Scenario: `dusk doctor --gc-dialogs` reaps stale dialogs

- **WHEN** `.ia/runtime/dialogs/` contains a dialog directory older than 24h, and `dusk doctor --gc-dialogs` is invoked
- **THEN** the stale dialog directory is deleted
- **AND** fresh dialog directories are preserved
- **AND** the command exits 0

#### Scenario: Every new command supports --help

- **WHEN** `dusk implement --help`, `dusk doctor --cleanup-worktrees --help`, `dusk doctor --gc-implement-checkpoints --help`, `dusk doctor --gc-dialogs --help` are invoked
- **THEN** each prints a usage description, a flag list, and at least one example invocation, and exits 0
