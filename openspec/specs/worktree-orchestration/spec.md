# worktree-orchestration Specification

## Purpose
TBD - created by archiving change phase-3-implementation-pipeline. Update Purpose after archive.
## Requirements
### Requirement: Parallel beads get isolated worktrees; dependency/serialization-linked beads run sequentially in place

`packages/runtime/worktree` SHALL implement Step 3 of the 9-step pipeline. For each bead in the DAG, the Bead Orchestrator SHALL decide parallel vs serial per RFC §6.3. Independent beads (no dependency or file-overlap edges between them) SHALL each get an isolated `git worktree add -b dusk/<bead-id> <path> origin/main`. Beads linked by typed-dependency or file-overlap serialization edges SHALL run sequentially in place — no second worktree is created for them on the shared file region. (RFC §6.2, §6.3; **P3-T23**.)

#### Scenario: Two independent beads get two worktrees off the same base

- **WHEN** the DAG contains two independent beads with no dependency or file-overlap edges between them
- **THEN** two `dusk/<bead-id>` worktrees are created, each off `origin/main`
- **AND** their per-bead directories are isolated (writes to one do not appear in the other's working tree)

#### Scenario: File-overlap-linked pair runs serially without a second worktree

- **WHEN** the DAG contains a pair linked by a file-overlap serialization edge
- **THEN** the pair runs sequentially in the same worktree
- **AND** the second bead's `git worktree add` is not invoked for the shared file region

### Requirement: Bead-id format follows the App. D.8 convention

Worktree branches SHALL be named `dusk/<bead-id>` where `<bead-id>` follows the format `bd_<14-digit-yyyymmddhhmmss><3-digit-seq>` per RFC App. D.8 (the Phase-1 id convention). Branch names SHALL be deterministic given the Clock-injected timestamp and the DAG ordinal. (RFC App. D.8.)

#### Scenario: Bead-id format is correct

- **WHEN** a worktree branch is created for a bead
- **THEN** the branch name matches the regex `^dusk/bd_[0-9]{14}[0-9]{3}$`

### Requirement: `dusk doctor --cleanup-worktrees` reaps orphans without prompting

The CLI SHALL provide `dusk doctor --cleanup-worktrees` which lists every `dusk/<bead-id>` worktree branch present in the repo, identifies those whose bead is not in any active `dusk_implement` run, and reaps them (`git worktree remove` + branch deletion). The command SHALL print one line per reaped worktree and exit 0 even when nothing was reaped (idempotent). (RFC §6.3.)

#### Scenario: Orphan worktrees are reaped

- **WHEN** the repo contains a `dusk/bd_…` worktree from a previous crashed run and no active pipeline references it
- **THEN** `dusk doctor --cleanup-worktrees` removes the worktree, deletes the branch, prints the reaped path, and exits 0

#### Scenario: No orphans → exit 0 silently

- **WHEN** `dusk doctor --cleanup-worktrees` runs on a clean repo with no `dusk/bd_…` branches
- **THEN** the command exits 0 with no output

