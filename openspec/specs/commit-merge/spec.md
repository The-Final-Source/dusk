# commit-merge Specification

## Purpose
TBD - created by archiving change phase-3-implementation-pipeline. Update Purpose after archive.
## Requirements
### Requirement: Each bead produces exactly one atomic commit carrying the full v9 trailer set

`packages/runtime/commit` SHALL implement Step 7 of the 9-step pipeline. For each bead that converges (or partially commits via L1 recovery), exactly one Conventional Commits-formatted commit SHALL be produced on the bead's branch (`dusk/<bead-id>`). The commit SHALL carry the full v9 trailer set per RFC App. A.7 in fixed order: `Intent` (one per touched intent), `Test-Intent` (one per executed test-pyramid intent), `Bead-id`, `Verdict-id`, `Test-Verdict-id`, `Trace-id`, `Verifier-model`, `Test-Runner-model`, `Long-cycle-samples`, `Test-Suites-passed`. Conditional trailers (`Partial: true`, `Deferred-Intent: <intent>`, `Verifier-bypassed-test-intent: <test-intent>[<triple>]`) SHALL appear ONLY when produced via their gated paths (L1 recovery / livelock `accept_test_as_is` resolution). (RFC §6.7, App. A.7; design D10; **P3-T19**.)

#### Scenario: Clean-converge bead has the complete unconditional trailer set

- **WHEN** a bead converges cleanly through Steps 4–6 and reaches Step 7
- **THEN** exactly one commit exists on its branch
- **AND** the commit's trailers include `Intent`, `Test-Intent`, `Bead-id`, `Verdict-id`, `Test-Verdict-id`, `Trace-id`, `Verifier-model`, `Test-Runner-model`, `Long-cycle-samples`, `Test-Suites-passed`
- **AND** the trailers appear in the fixed order specified by App. A.7
- **AND** the commit does NOT carry `Partial`, `Deferred-Intent`, or `Verifier-bypassed-test-intent`

#### Scenario: Conditional trailers appear only on their gated paths

- **WHEN** a bead reaches Step 7 via L1 recovery (some intents satisfied, some deferred)
- **THEN** the commit carries `Partial: true` and one `Deferred-Intent` trailer per deferred intent
- **AND** when a bead reaches Step 7 via livelock `accept_test_as_is` resolution, the commit additionally carries `Verifier-bypassed-test-intent: <test-intent>[<triple>]`

### Requirement: Step 8 rebases parallel beads topologically and recognizes `Partial: true` to suppress drift warnings

`packages/runtime/merge` SHALL implement Step 8. The merge SHALL walk the bead DAG in topological order, rebasing each branch (`dusk/<bead-id>`) onto `main`. For each rebase, snapshot-drift detection SHALL compare `main`'s decoration set against (session-snapshot ∪ this branch's expected additions). When a commit carries `Partial: true`, the deferred-intent additions SHALL be included in the expected-additions set so they do not trigger a drift warning. Successful rebases SHALL remove the bead's worktree (`git worktree remove`). (RFC §6.8; design D11; **P3-T20**.)

#### Scenario: Topological rebase order

- **WHEN** the bead DAG contains two dependency-linked beads A→B and one independent bead C
- **THEN** Step 8 rebases A first, then B, then C (or interleaves C with A but never B before A)
- **AND** each rebased worktree is removed after its branch lands

#### Scenario: `Partial: true` suppresses drift for deferred-intent additions

- **WHEN** an L1 partial-commit branch is rebased
- **THEN** the deferred-intent decorations added by the bead are recognized as the branch's expected additions
- **AND** no `snapshot_drift` warning is emitted for them
- **AND** genuine drift (decorations from other origins) still triggers a `snapshot_drift` warning

### Requirement: The Conflict Resolver prefers more-specific decoration and surfaces equal-specificity ties as TODOs

`packages/runtime/conflict-resolver` SHALL be spawned on every real rebase conflict that involves decorated code. It SHALL implement a decorator-aware merge: prefer the side declaring more aspect ids, OR the side declaring the more granular intent path; equal-specificity ties SHALL be left as TODO markers in the merged file so the human reviewer can adjudicate. The Conflict Resolver SHALL be `memory: none` (RFC §9 role table). (RFC §6.8; design D11; **P3-T20**.)

#### Scenario: Conflict Resolver picks the more-specific side

- **WHEN** a rebase conflict involves a region decorated `@intent api/pagination [cursor-decode]` on one side and `@intent api/pagination [cursor-decode, cursor-encode]` on the other
- **THEN** the resolver keeps the side declaring two aspect ids (more specific)

#### Scenario: Equal-specificity conflict becomes a TODO

- **WHEN** both sides declare identical decorator specificity but differ in body content
- **THEN** the resolver writes a TODO marker into the merged file naming the conflicting region and the equal-specificity reason
- **AND** the rebase fails with the TODO present so a human reviewer can resolve it

### Requirement: Step 9 returns a complete machine-readable summary

`packages/runtime/orchestrator` SHALL implement Step 9. On successful pipeline completion, `dusk_implement` SHALL return `{ commits[], beads_summary[], intents_touched[], test_intents_executed[], trace_ids[], total_duration_ms, total_cost_usd }`. The summary SHALL be returned to the MCP caller as the success shape of `dusk_implement` (not a `DuskError`). (RFC §6.9; **P3-T21**.)

#### Scenario: Return summary carries all required fields

- **WHEN** a multi-bead `dusk_implement` run completes successfully (all beads converged through Step 8)
- **THEN** the return value contains `commits[]` (one entry per bead with `bead_id`, `commit_sha`, `branch`), `beads_summary[]` (per-bead status + exit-iter), `intents_touched[]` (deduped), `test_intents_executed[]` (deduped), `trace_ids[]`, `total_duration_ms`, `total_cost_usd`
- **AND** every required field is populated with non-empty values

