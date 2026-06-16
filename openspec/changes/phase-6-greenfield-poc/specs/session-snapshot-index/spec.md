## MODIFIED Requirements

### Requirement: A session snapshot is built once at pipeline entry and frozen for the run

`packages/runtime/orchestrator` SHALL build the session snapshot at the start of every `dusk_implement` invocation by querying the Phase-1 derived-index against the merge-base commit. The **default** base ref SHALL resolve through an ordered fallback `origin/main → main → HEAD` (so a fresh standalone repo with no remote resolves to its local trunk / current tip); an **explicit** `--base-ref` SHALL resolve strictly (no fallback) and fail honestly if it does not exist. The snapshot SHALL be immutable for the run's lifetime, identified by `index_snapshot_id = sha256(merge_base_commit + index_serialization)`, and every `SubAgentTrace` emitted during the run SHALL carry this id. The `--rebuild-index` flag SHALL force re-derivation of the snapshot within an existing session, producing a new `index_snapshot_id`. (RFC §2.10; design D1; App. D.27.)

#### Scenario: Every trace in a run carries the same `index_snapshot_id`

- **WHEN** a multi-bead `dusk_implement` run completes
- **THEN** every `SubAgentTrace` event in `.ia/observability/traces.jsonl` for that run carries the same non-null `index_snapshot_id`

#### Scenario: `--rebuild-index` produces a new snapshot id mid-session

- **WHEN** a `dusk_implement` invocation runs to completion, then a second invocation runs with `--rebuild-index` in the same session
- **THEN** the second run's traces carry a different `index_snapshot_id` from the first run's

#### Scenario: A standalone repo with no remote resolves the default base ref via fallback

- **WHEN** the snapshot is built in a fresh repo that has at least one commit but no `origin/main`
- **THEN** the default base ref falls back (`main` or `HEAD`) and the snapshot's merge-base resolves to a concrete commit SHA
- **AND** the run proceeds without a `fatal: ambiguous argument 'origin/main'` failure
