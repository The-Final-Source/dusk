## MODIFIED Requirements

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
