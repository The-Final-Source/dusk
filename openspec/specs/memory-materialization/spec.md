# memory-materialization Specification

## Purpose
TBD - created by archiving change phase-2-runtime-verification. Update Purpose after archive.
## Requirements
### Requirement: Four memory scopes are materialized at spawn time

`packages/runtime/memory` SHALL materialize four memory scopes per role frontmatter — `none` (empty block), `bead` (read `.ia/runtime/beads/<bead-id>/<role>.md` if present; create empty on first write), `dialog` (read `.ia/runtime/dialogs/<dialog-id>/<role>.md`), `session` (read `.ia/runtime/session/<role>.md`) — and SHALL emit the rendered block consumed by the spawn-pipeline assembler (§sub-agent-runtime). When the memory file is absent, the rendered block is the empty block — never an error. (RFC §9.6; Plan P2 scope.)

#### Scenario: First bead spawn finds no memory file and renders empty

- **WHEN** an Engineer spawns against a `beadId` whose memory file does not yet exist
- **THEN** the memory rendering is empty
- **AND** no file is created until the post-spawn write-back step

#### Scenario: Verifier memory: none ignores any existing bead memory file

- **WHEN** a Verifier spawns against the same `beadId` whose Engineer memory file exists and contains a populated `## Current diagnosis` section
- **THEN** the Verifier's memory rendering is the empty block (no read occurred for that file)

### Requirement: Bead memory uses a structured dual-channel format

The bead memory file at `.ia/runtime/beads/<bead-id>/<role>.md` SHALL be YAML frontmatter (`bead_id`, `role`, `last_iter`, `last_compacted_at_iter`) followed by named Markdown sections per RFC §9.6.1: `## Current diagnosis`, `## Approaches tried (impl)`, `## Approaches tried (test-authoring)`, `## Verifier signals (last 3)`, `## Intent set in scope`, `## Files being modified`. The two `Approaches tried` channels are the impl + test-authoring dual channels, each entry carrying `(approach_label, attempted_at_iter, triple_slot_focus, summary)`. The format round-trips deterministically — parse-then-serialize is byte-identical. (RFC §9.6.1; design D6; Plan P2-T2.)

#### Scenario: A populated bead memory parses + re-serializes byte-identically

- **WHEN** a bead memory file containing all six named sections + frontmatter is read and immediately written back through the typed API
- **THEN** the new file bytes equal the original bytes

#### Scenario: A bead in test-authoring mode populates the test-authoring channel

- **WHEN** the Engineer is in the two-stage test-satisfaction sub-loop and records an attempt with structural-approach label `mock-call-order`
- **THEN** the new entry appears under `## Approaches tried (test-authoring)` and not under `## Approaches tried (impl)`

### Requirement: Compaction is a pure, deterministic transform that performs no model call

Bead-memory compaction SHALL be implemented as a pure function `compact(memory: BeadMemory): BeadMemory` invoked by the Bead Orchestrator on write-back. It SHALL fire when `## Verifier signals (last 3)` exceeds three entries, SHALL keep the most recent three entries verbatim in that section, and SHALL fold older entries into the appropriate `## Approaches tried (impl|test-authoring)` channel preserving `(triple_id, focal_verdict, slot_focus, approach_label)` and dropping only verbose rationale. The transform SHALL emit zero model calls. (RFC §9.6.1; design D6; Plan P2-T2.)

#### Scenario: Compaction preserves load-bearing facts and drops rationale

- **WHEN** a memory file with five `Verifier signals` entries is compacted
- **THEN** the new file's `Verifier signals` section contains the most recent three entries verbatim
- **AND** the two older entries appear under `Approaches tried (impl|test-authoring)` preserving `triple_id`, `focal_verdict`, `slot_focus`, and `approach_label`
- **AND** the older entries' verbose rationale text is absent
- **AND** the trace stream records no `role: verifier`/`engineer` model call during the write-back

### Requirement: Memory size is bounded across iteration depth

Across simulated short-cycle iterations the bead memory file SHALL NOT grow unboundedly with iteration depth: at iter 20 the file size SHALL be within a small tolerance of the file size at iter 3 (compaction holds steady-state). (RFC §9.6.1; design D6; Plan P2-T2.)

#### Scenario: 20-iter simulated drive holds file size near the iter-3 baseline

- **WHEN** a scripted-verdict-driven 20-iteration short cycle writes back to bead memory each iteration
- **THEN** `size(iter 20) ≈ size(iter 3)` within tolerance (the file does not grow with iteration depth)

### Requirement: The Engineer's convergence diagnosis is structurally invisible to the Verifier

The Engineer's diagnosis SHALL be written into the bead-memory `## Current diagnosis` section and SHALL inform the Bead Orchestrator only. It SHALL NOT enter any Verifier spawn payload. This is enforced structurally by the §sub-agent-runtime spawn pipeline rendering the empty memory block for `memory: none` roles regardless of the bead memory file's content. (RFC §6.4, §9.6.1, App. A.6 note; design D3; round-3 board fix; Plan P2-T3.)

#### Scenario: A seeded diagnosis does not appear in the Verifier's raw_prompt

- **WHEN** the bead memory's `## Current diagnosis` is seeded with distinctive text and a Verifier is then spawned against the same bead
- **THEN** the Verifier trace's `raw_prompt` contains zero substrings from the seeded diagnosis
- **AND** the Verifier trace carries no diagnosis field
- **AND** `convergence_diagnosis_present` appears only on the Bead-Orchestrator trace

### Requirement: Dialog and session memory follow the same structured-file convention

`memory: dialog` and `memory: session` SHALL each be persisted as their own named file under `.ia/runtime/dialogs/<dialog-id>/<role>.md` and `.ia/runtime/session/<role>.md` respectively, parsed through the same typed API. Dialog directories are created at `dusk_author_start` time (Phase 4 consumer); session files are created at the first session spawn. (RFC §9.6; Plan P2 scope.)

#### Scenario: A session-scoped spawn reads and writes the session file

- **WHEN** the Root Orchestrator (memory: session) spawns twice within the same session and writes back between spawns
- **THEN** the second spawn's memory rendering contains the first spawn's written content

