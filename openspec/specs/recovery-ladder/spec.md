# recovery-ladder Specification

## Purpose
TBD - created by archiving change phase-3-implementation-pipeline. Update Purpose after archive.
## Requirements
### Requirement: The recovery ladder is a deterministic decision function over satisfaction state at exhaustion

`packages/runtime/recovery-ladder` SHALL implement a pure decision function invoked when the 40-iter lifetime budget exhausts. Inputs: `(satisfaction_state, partial_commit_valid, freeze_writable)`. Transitions per RFC §6.4.1:

- L1 partial commit ← `(≥1 intent satisfied) ∧ partial_commit_valid`
- L2 intent-modification proposal ← `(¬L1) ∧ proposal_generation_succeeds`
- L3 operator-actionable freeze ← `(¬L2) ∧ freeze_writable`
- L4 hard abort ← otherwise (i.e., freeze cannot serialize)

**L4 fires ONLY on freeze-serialization failure** — NOT on "nothing satisfiable" (that's L2's recoverable case). The full 4-level ladder ships in Phase 3 (round-4 board fix; the round-3 split produced a semantic contradiction). L2's *recovery action* (`dusk_author_continue`) lands in Phase 4; L2's *artifact + error contract* (the YAML + `bead_intent_revision_needed`) is fully here. (RFC §6.4.1; design D3.)

#### Scenario: A zero-satisfiable bead emits L2 (recoverable), not L4 (hard abort)

- **WHEN** a bead exhausts its lifetime budget with no intent satisfied AND `proposal_generation_succeeds`
- **THEN** the result is `DuskError { kind: "bead_intent_revision_needed", recoverable: true }`
- **AND** the result is NOT `DuskError { kind: "bead_aborted", recoverable: false }` (the round-3 mistake)

### Requirement: Level 1 partial commit ships satisfiable intents and defers the rest

When L1 fires, the bead SHALL produce exactly one commit on its branch carrying `Partial: true` and one `Deferred-Intent: <intent-path>` trailer per deferred intent. The satisfiable intents' `Intent:` trailers SHALL appear; the deferred intents' SHALL NOT. The deferred intents SHALL be written to `.ia/runtime/beads/<bead-id>/deferred.yaml` (a typed YAML readable by Phase 5's audit). Step 8 rebase SHALL merge the commit to main without `snapshot_drift` warnings for the deferred-intent additions. (RFC §6.4.1; design D3, D11; **P3-T11**.)

#### Scenario: L1 partial commit lands cleanly on main

- **WHEN** a two-intent bead exhausts its lifetime budget with intent A verifiable and B not, via the scripted-verdict Verifier double
- **THEN** exactly one commit exists on the bead's branch carrying `Partial: true` and `Deferred-Intent: B`
- **AND** the commit carries `Intent: A [<aspects>]`
- **AND** the commit does NOT carry `Intent: B`
- **AND** `.ia/runtime/beads/<bead-id>/deferred.yaml` exists and lists B
- **AND** Step 8 rebases the commit to main with no `snapshot_drift` warning for the deferred-intent additions

### Requirement: Level 2 produces a recoverable intent-modification proposal aggregating all lifetime diagnoses

When L2 fires, the bead SHALL write `.ia/runtime/beads/<bead-id>/intent-proposal.yaml` aggregating **all** lifetime diagnoses (which triple seems unsatisfiable, proposed affirmative rephrasings, scope-narrowings) from the bead memory's diagnosis history. The result SHALL be `DuskError { kind: "bead_intent_revision_needed", recoverable: true }` whose `recovery_hint` points at `dusk_author_continue`. (RFC §6.4.1; design D3; **P3-T12**.)

#### Scenario: L2 writes the proposal and returns a recoverable error

- **WHEN** a bead exhausts its lifetime budget with no intent satisfiable AND partial commit invalid AND proposal generation succeeds
- **THEN** `.ia/runtime/beads/<bead-id>/intent-proposal.yaml` is written aggregating every diagnosis the bead produced over its lifetime
- **AND** the result is `DuskError { kind: "bead_intent_revision_needed", recoverable: true }`
- **AND** the `recovery_hint` string names `dusk_author_continue` as the next step

### Requirement: Level 3 freezes operator-actionably and resumes via `dusk implement --resume`

When L3 fires, the bead's worktree SHALL be preserved (not removed), and `.ia/runtime/beads/<bead-id>/freeze-state.md` SHALL carry the bead memory + last 3 verdicts + diagnosis history. The result SHALL be `DuskError { kind: "bead_frozen", recoverable: false }`. The CLI SHALL provide `dusk implement --resume <bead-id>` that resumes the frozen bead from the preserved state. (RFC §6.4.1; design D3; **P3-T12b**.)

#### Scenario: L3 freezes state; resume continues from where it stopped

- **WHEN** L2 proposal generation fails AND freeze is writable
- **THEN** the bead's worktree is preserved
- **AND** `.ia/runtime/beads/<bead-id>/freeze-state.md` exists and contains the bead memory + last 3 verdicts + diagnosis history
- **AND** the result is `DuskError { kind: "bead_frozen", recoverable: false }`
- **AND** `dusk implement --resume <bead-id>` reloads the frozen state and resumes the bead's Step-4 entry

### Requirement: Level 4 hard-aborts ONLY when freeze cannot serialize

L4 SHALL fire ONLY when L3 freeze-state serialization fails (e.g., disk error). Result: `DuskError { kind: "bead_aborted", recoverable: false }`. L4 SHALL NOT fire for "nothing satisfiable" (which is L2's case). (RFC §6.4.1; design D3; **P3-T12c**.)

#### Scenario: Disk error during freeze triggers L4

- **WHEN** L3 attempts to write `freeze-state.md` but the disk write fails
- **THEN** the result is `DuskError { kind: "bead_aborted", recoverable: false }`
- **AND** no `intent-proposal.yaml` is interpreted as L4 (the cascade did not skip L2 inappropriately)

#### Scenario: Nothing-satisfiable does NOT trigger L4

- **WHEN** a bead exhausts with no intent satisfiable AND partial commit invalid AND proposal generation succeeds AND freeze is writable
- **THEN** the result is L2 `bead_intent_revision_needed` (not L4 `bead_aborted`)
- **AND** L4 is NOT reached in this case

### Requirement: Level 2's recovery action consumes `intent-proposal.yaml` via Author Stage 3 injection

Phase 3's Recovery Ladder L2 ships the *artifact* (`.ia/runtime/beads/<bead-id>/intent-proposal.yaml`) and the *recoverable error* (`DuskError { kind: "bead_intent_revision_needed", recoverable: true }`). Phase 4 SHALL ship L2's *recovery action*: the harness invokes `dusk_author_start({entry_mode: "l2_recovery", dialog_init: { proposal_path }})` to open a dialog that begins at Stage 3 with the proposal injected as the practice-proposal content (per design D6). After the dialog finalizes via `dusk_author_finalize`, the refined intent is written into `.ia/intents/<path>/intent.yaml` (Stage 5 atomic write); the user then re-invokes `dusk_implement({request: <original>})` to retry the bead. The bead's prior deferred state SHALL NOT be auto-restored — re-invoking `dusk_implement` is the user's explicit decision. (RFC §6.4.1; design D6.)

#### Scenario: L2 error → user authors revision → re-invoke `dusk_implement` succeeds

- **WHEN** an L2 `bead_intent_revision_needed` error is produced (with an `intent-proposal.yaml` written), the user invokes `dusk_author_start({entry_mode: "l2_recovery"})` against the proposal, drives the dialog through `dusk_author_finalize`, and then re-invokes `dusk_implement` with the original request
- **THEN** the refined intent is committed to `.ia/intents/<path>/intent.yaml`
- **AND** the new `dusk_implement` run resolves the previously-problematic intent
- **AND** the run completes successfully through Steps 1–9 if no further blockers arise

#### Scenario: An L2-recovery dialog with a malformed proposal returns a typed error

- **WHEN** `dusk_author_start({entry_mode: "l2_recovery", dialog_init: { proposal_path }})` is called with a `proposal_path` whose file does not exist or fails the proposal schema
- **THEN** the response is `DuskError { kind: "author_l2_proposal_unreadable", recoverable: true }` naming the failing path
- **AND** no dialog directory is created

### Requirement: L3 freeze artifact + `dusk implement --resume` (Phase 3 contract preserved)

Phase 3's L3 freeze artifact and `dusk implement --resume <bead-id>` flow SHALL continue to work exactly as Phase 3 shipped — Phase 4 does NOT alter L3 semantics. (RFC §6.4.1; Phase 3 `recovery-ladder` contract held.)

#### Scenario: L3-frozen bead resumes correctly post-Phase-4

- **WHEN** a Phase-3 L3-frozen bead (a `freeze-state.md` exists) is resumed via `dusk implement --resume <bead-id>` in a Phase-4-installed repo
- **THEN** the bead resumes from the frozen Step-4 state per the Phase-3 contract
