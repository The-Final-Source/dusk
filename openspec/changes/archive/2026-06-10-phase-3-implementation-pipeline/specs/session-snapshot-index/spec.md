## ADDED Requirements

### Requirement: A session snapshot is built once at pipeline entry and frozen for the run

`packages/runtime/orchestrator` SHALL build the session snapshot at the start of every `dusk_implement` invocation by querying the Phase-1 derived-index against the merge-base commit (default `origin/main`). The snapshot SHALL be immutable for the run's lifetime, identified by `index_snapshot_id = sha256(merge_base_commit + index_serialization)`, and every `SubAgentTrace` emitted during the run SHALL carry this id. The `--rebuild-index` flag SHALL force re-derivation of the snapshot within an existing session, producing a new `index_snapshot_id`. (RFC §2.10; design D1.)

#### Scenario: Every trace in a run carries the same `index_snapshot_id`

- **WHEN** a multi-bead `dusk_implement` run completes
- **THEN** every `SubAgentTrace` event in `.ia/observability/traces.jsonl` for that run carries the same non-null `index_snapshot_id`

#### Scenario: `--rebuild-index` produces a new snapshot id mid-session

- **WHEN** a `dusk_implement` invocation runs to completion, then a second invocation runs with `--rebuild-index` in the same session
- **THEN** the second run's traces carry a different `index_snapshot_id` from the first run's

### Requirement: Cross-bead queries see the snapshot only; same-bead queries see snapshot ∪ delta

Per-bead `BeadDelta` records SHALL be in-process objects (not files) capturing decoration writes the bead's Engineer has performed in its worktree but not yet merged. A bead's OWN Verifier/Test Runner/Bead Orchestrator queries SHALL see `snapshotQuery ∪ beadDelta`; cross-bead queries (Decomposer file-overlap construction, long-cycle universe computation, focal/support claim-overlap precondition) SHALL see the snapshot only. This preserves the Phase-1 derived-index query interface (no signature change). (RFC §2.10, §6.5; design D1; **P3-T1**.)

#### Scenario: Bead A's writes are invisible to bead B's cross-bead queries

- **WHEN** a 2-bead `dusk_implement` run is in flight and bead A writes a new decoration to its worktree
- **THEN** bead B's Decomposer file-overlap query, long-cycle universe query, and cross-bead overlap precondition see only the snapshot (A's decoration is absent)
- **AND** bead A's own Verifier scope query sees its delta (A's decoration is present)

### Requirement: Snapshot query interface preserves Phase-1 signatures

The session-snapshot read model SHALL expose the same forward / reverse / focal+support / aspect-rollup / test-discovery + hierarchical-satisfaction query signatures as the Phase-1 `derived-index` capability. Phase 3 SHALL NOT modify those signatures; only the backing store changes (the Phase-1 D6 cross-change contract). (Phase-1 `derived-index` capability; Phase-1 archived design D6; RFC §2.10.)

#### Scenario: Existing Phase-2 read-path tools work against the snapshot backing

- **WHEN** the MCP server's `dusk_inspect` is invoked during an in-flight `dusk_implement` run
- **THEN** the response uses the snapshot for its index queries and returns results structurally identical to the Phase-2 contract
