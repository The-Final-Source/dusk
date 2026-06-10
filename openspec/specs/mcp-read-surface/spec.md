# mcp-read-surface Specification

## Purpose
TBD - created by archiving change phase-2-runtime-verification. Update Purpose after archive.
## Requirements
### Requirement: An MCP server hosts the Phase-2 read-only tools, resources, and uniform error envelope

`packages/delivery/mcp-server` SHALL bootstrap a Model Context Protocol server exposing the Phase-2 read-only tools — `dusk_status`, `dusk_inspect`, `dusk_verify`, plus the paired fallback tools `dusk_list_intents`, `dusk_get_intent`, `dusk_list_traces`, `dusk_list_beads`, `dusk_get_bead`, `dusk_list_implement_checkpoints` — and the equivalent MCP resources for the same data. Every tool SHALL return a `Result`-shaped envelope translated at the MCP boundary into the success shape or a typed `DuskError` (RFC App. A.11). No tool SHALL throw across the MCP boundary. (RFC §10.1; design D10/D11.)

#### Scenario: The MCP server starts and lists the Phase-2 tools

- **WHEN** the MCP server is started against a Phase-2 install
- **THEN** the advertised tool list contains exactly the named Phase-2 read-only tools
- **AND** the advertised resource list contains the equivalent `dusk://` URIs

### Requirement: `dusk_status` returns the documented shape against an idle system

`dusk_status({})` SHALL return `{active_beads, recent_verdicts, recent_test_runs, index_stats}` with empty collections and a populated `index_stats` against a freshly-started server. It SHALL NOT return a `DuskError` for the idle case. (RFC §10.1; Plan P2-T20.)

#### Scenario: Status on a fresh idle server

- **WHEN** `dusk_status` is called on an MCP server that has never run a pipeline
- **THEN** the response is the success shape with empty collections
- **AND** `index_stats` reflects the actual loaded index (intent count, decoration-row count)

### Requirement: `dusk_inspect` reports hierarchical satisfaction, claim lists, and low-confidence supports

`dusk_inspect({scope})` SHALL return `{intents[], claims[], support_claims[], aspects_unsatisfied[], test_intents[], low_confidence_supports[]}`. Hierarchical satisfaction SHALL follow RFC §2.9: a parent intent is satisfied iff its own triples pass AND every direct child (including test-pyramid children) is satisfied. The `low_confidence_supports[]` field SHALL list `{intent_path, aspect_id, claim: {file, lines, quote}, support_triple, triple_verdict}` entries derived from the most recent verdict per intent. (RFC §10.1, §2.9, §3.3; design D11; Plan P2-T8/T11.)

#### Scenario: Inspect on the App. B fixture mirrors the index truthfully

- **WHEN** `dusk_inspect({scope: "notifications/send"})` runs against the App. B fixture
- **THEN** `claims`, `support_claims`, `aspects_unsatisfied`, and `test_intents` match the derived-index queries
- **AND** the unit-tests child intent shows unsatisfied until test code exists

#### Scenario: Inspect surfaces low_confidence supports after a low-confidence verdict

- **WHEN** a verdict on an intent has produced `support_quality: low_confidence` with a `mismatch` claim
- **THEN** `dusk_inspect` for that intent includes that claim under `low_confidence_supports[]` with the documented field set

### Requirement: `dusk_verify` runs the Verifier procedure read-only and mutates no state

`dusk_verify({diff?, scope?, intents?})` SHALL invoke the §verifier-procedure end-to-end and return a `Verdict` (App. A.4) per intent. It SHALL NOT write to the file system, SHALL NOT create commits, SHALL NOT trigger Engineer iteration, and SHALL NOT alter the derived index. The call is purely read-side. (RFC §10.1, §3.3, App. A.4; Plan P2-T12.)

#### Scenario: Verifying the worked example is non-mutating

- **WHEN** `dusk_verify` is called over the App. B fixture
- **THEN** the working tree is unchanged
- **AND** no commit is produced
- **AND** the returned Verdicts include the negative-polarity and `implies` cases with their correct shapes

### Requirement: Resources and paired tools return structurally equivalent data

For every paired resource/tool — `dusk://intents` ↔ `dusk_list_intents`, `dusk://intents/<path>` ↔ `dusk_get_intent`, `dusk://traces/recent` ↔ `dusk_list_traces`, `dusk://beads/active` ↔ `dusk_list_beads`, `dusk://beads/<id>` ↔ `dusk_get_bead`, `dusk://implement-checkpoints` ↔ `dusk_list_implement_checkpoints` — the two surfaces SHALL return structurally equivalent data after parse (same intent ids, same field set, same counts), routed through a single shared query function. Byte-identity is NOT required (serializers may format whitespace or field order differently). (RFC §10.1; design D10; Plan P2-T13.)

#### Scenario: Resource and paired tool agree on the intents listing

- **WHEN** `dusk://intents` is read and `dusk_list_intents({})` is called against the same server
- **THEN** the two parsed payloads contain the same set of intent ids and the same per-intent field set

### Requirement: Every tool returns a typed `DuskError` on failure, not a throw

Each MCP tool SHALL translate internal failures into a typed `DuskError` carrying the documented `kind` and `recoverable` flag (App. A.11). `dusk_get_intent` against an unresolvable path SHALL return `intent_path_unresolved`; `dusk_verify` whose assembled evidence overflows SHALL return `verifier_evidence_too_large`. No exception SHALL escape across the MCP boundary. (RFC App. A.11; Plan P2-T14.)

#### Scenario: Unresolvable path returns a typed error

- **WHEN** `dusk_get_intent({path: "nonexistent/intent"})` is called
- **THEN** the response is a `DuskError { kind: "intent_path_unresolved", recoverable: true }`

#### Scenario: Evidence overflow returns a typed error, not an exception

- **WHEN** `dusk_verify` is called with a scope whose assembled evidence exceeds `verifier_evidence_max_lines`
- **THEN** the response is a `DuskError { kind: "verifier_evidence_too_large" }`
- **AND** the MCP layer reports no thrown exception

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

