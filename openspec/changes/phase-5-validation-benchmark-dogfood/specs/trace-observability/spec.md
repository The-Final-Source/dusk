## ADDED Requirements

### Requirement: Every sub-agent call emits one fully-populated SubAgentTrace with all v9 fields

`packages/runtime/observability` SHALL complete the `SubAgentTrace` emission so that every sub-agent call in a pipeline run writes exactly one event to `.ia/observability/traces.jsonl` carrying every v9 field relevant to its role and invocation site: `schema_version`, `trace_id`, `index_snapshot_id`, `role`, `invocation_site`, `model`, token counts, latency, cost, `skills_loaded[]`; short-cycle events additionally carry `iteration_number`, `verdict_delta_from_prior`, `failing_triple_set`, `engineer_change_summary`; Bead-Orchestrator events (and ONLY Bead-Orchestrator events) carry `convergence_diagnosis_present` and `stuckness_detector_state`; livelock events carry `verifier_livelock_signal`; long-cycle confirmation events carry `confirmation_of_trace_id` and `confirmation_pass_outcome`. The fields Phases 2/3 reserved are populated, not redefined — the `SubAgentTrace` schema shape is unchanged. (RFC §7.2, App. A.6; design context; **P5-T1**.)

#### Scenario: A pipeline exercising stuckness, confirmation, and livelock produces a complete trace stream

- **WHEN** a pipeline run (driven via the scripted-verdict double) exercises a stuckness fire, a long-cycle confirmation pass, and a livelock detection, and `traces.jsonl` is read afterward
- **THEN** there is exactly one event per sub-agent call
- **AND** the relevant events carry `index_snapshot_id`, `iteration_number`, `verdict_delta_from_prior`, `failing_triple_set`, `engineer_change_summary`, `stuckness_detector_state`, `verifier_livelock_signal`, `confirmation_of_trace_id`, `confirmation_pass_outcome`, and `skills_loaded[]`
- **AND** `convergence_diagnosis_present` appears only on Bead-Orchestrator events (never on Verifier events)

### Requirement: traces.jsonl is ring-buffered by size with rename-based rotation

The trace file SHALL rotate when it exceeds `dusk.config.yml > observability.trace_ring_bytes` (default 64 MiB): `traces.jsonl` is renamed to `traces.1.jsonl` (one prior generation kept) and a fresh file starts. Rotation SHALL rename, never truncate in place, so an open read handle on the renamed file remains valid. An audit or benchmark run SHALL snapshot the file boundaries at start and read a consistent window — rotation during a run SHALL NOT drop events from under it. (Design D3.)

#### Scenario: Rotation preserves an in-flight reader's window

- **WHEN** an audit run snapshots the trace-file boundaries and a rotation fires mid-read
- **THEN** the audit's read window remains complete (the renamed file is still readable through the held handle)
- **AND** post-rotation events land in the fresh `traces.jsonl`

#### Scenario: Exceeding the ring ceiling rotates exactly one generation

- **WHEN** `traces.jsonl` grows past the configured `trace_ring_bytes`
- **THEN** the file is renamed to `traces.1.jsonl`, replacing any prior generation
- **AND** a fresh `traces.jsonl` receives subsequent events

### Requirement: Optional mirrors are out-of-band file-tail forwarders that never block the pipeline

When `dusk.config.yml > observability.mirrors[]` is configured, mirror forwarders SHALL run as out-of-band tasks that tail `traces.jsonl` — they SHALL NOT be hooks in the trace-emission path. The pipeline's only I/O obligation is the local file append. An unreachable, slow, or crashed sink SHALL produce no pipeline error and no pipeline delay. Each forwarder SHALL keep a cursor file (`.ia/observability/.cursor-<sink>`) so restarts resume without re-sending from zero; delivery is at-least-once. v1 ships the OTLP forwarder implemented + tested and the PostHog forwarder as an adapter over the same tail-cursor machinery. (RFC §7.2, §10.3; design D4, Q3; **P5-T12**.)

#### Scenario: An unreachable OTLP sink does not block or fail the run

- **WHEN** an OTLP mirror is configured pointing at an unreachable endpoint and a full pipeline run executes
- **THEN** `traces.jsonl` is written completely
- **AND** the pipeline finishes normally with no sink-related error in its result
- **AND** the forwarder's failure is visible only in its own out-of-band logging

#### Scenario: A restarted forwarder resumes from its cursor

- **WHEN** a forwarder with an existing cursor file is restarted
- **THEN** it resumes tailing from the recorded cursor position rather than re-sending the whole file
