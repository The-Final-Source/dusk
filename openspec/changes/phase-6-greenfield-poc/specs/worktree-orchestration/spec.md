## MODIFIED Requirements

### Requirement: Parallel beads get isolated worktrees; dependency/serialization-linked beads run sequentially in place

`packages/runtime/worktree` SHALL implement Step 3 of the 9-step pipeline. For each bead in the DAG, the Bead Orchestrator SHALL decide parallel vs serial per RFC §6.3. Independent beads (no dependency or file-overlap edges between them) SHALL each get an isolated `git worktree add -b dusk/<bead-id> <path> <base>`, where `<base>` is the session snapshot's **resolved merge-base SHA** supplied by the caller — NOT a hardcoded `origin/main`, which a fresh standalone repo (no remote) lacks. `addWorktree` SHALL **require** an explicit `baseRef` and **fail loud** (`worktree_creation_failed`) if it is absent — there is no implicit `origin/main` default that could silently base a worktree on a wrong/absent ref. Beads linked by typed-dependency or file-overlap serialization edges SHALL run sequentially in place — no second worktree is created for them on the shared file region. (RFC §6.2, §6.3, App. D.27; **P3-T23**.)

#### Scenario: Two independent beads get two worktrees off the same resolved base

- **WHEN** the DAG contains two independent beads with no dependency or file-overlap edges between them
- **THEN** two `dusk/<bead-id>` worktrees are created, each off the caller-supplied resolved base ref
- **AND** their per-bead directories are isolated (writes to one do not appear in the other's working tree)

#### Scenario: File-overlap-linked pair runs serially without a second worktree

- **WHEN** the DAG contains a pair linked by a file-overlap serialization edge
- **THEN** the pair runs sequentially in the same worktree
- **AND** the second bead's `git worktree add` is not invoked for the shared file region

#### Scenario: A missing base ref fails loud

- **WHEN** `addWorktree` is called without an explicit `baseRef`
- **THEN** it returns `worktree_creation_failed` naming the missing `baseRef`
- **AND** no worktree is created off an implicit `origin/main`
