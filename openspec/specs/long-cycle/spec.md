# long-cycle Specification

## Purpose
TBD - created by archiving change phase-3-implementation-pipeline. Update Purpose after archive.
## Requirements
### Requirement: The affected universe is direct ∪ adjacent (1-hop), snapshot-only

`packages/runtime/long-cycle` SHALL implement Step 5 of the 9-step pipeline. For each bead, the long-cycle SHALL compute the affected universe as `direct ∪ adjacent` per RFC §6.5: `direct` = claims modified in this bead's diff; `adjacent` = claims in files importing-from or imported-by this bead's files (1-hop). The universe SHALL be computed against the session snapshot only — the bead's own in-flight delta SHALL be excluded (per design D1, cross-bead queries see the snapshot only, and the bead's own writes are the diff under test). The universe SHALL NOT include 2-hop neighbors. (RFC §6.5, §2.10; design D1; **P3-T26**.)

#### Scenario: Universe is direct ∪ 1-hop adjacent, snapshot-only

- **WHEN** a bead modifies file F that imports G and is imported by H
- **THEN** the sampled universe includes claims in F (direct), G (1-hop imports), and H (1-hop imported-by)
- **AND** the universe excludes claims in any 2-hop neighbor (a file imported by G that doesn't touch F)
- **AND** the universe excludes any in-flight delta the bead has written to its worktree

### Requirement: N=10 shuffle sharding samples random unique tuples from the universe

The long-cycle SHALL sample 10 random unique `(intent_path, claimant)` tuples from the affected universe per round (configurable via `sanity.long_cycle_round_count`, default 10). Each tuple SHALL be evaluated by spawning a fresh Verifier (`memory: none`) and recording the verdict. The cycle SHALL stop early if the universe is exhausted before 10 samples. (RFC §6.5, App. D.3; **P3-T13**.)

#### Scenario: Clean diff over ≥10-tuple universe samples exactly 10 verdicts and progresses

- **WHEN** a regression-free bead runs Step 5 over a universe containing ≥10 tuples
- **THEN** exactly 10 sampled verdicts are recorded
- **AND** all 10 verdicts are accept
- **AND** the pipeline progresses to Step 6

#### Scenario: Small universe causes early stop

- **WHEN** the universe contains only 4 tuples
- **THEN** the cycle samples 4 verdicts (no more) and progresses to Step 6 if all accept

### Requirement: The N=2 confirmation pass fires only on the first reject in a round set

When the first `reject` verdict appears in a round set, the Bead Orchestrator SHALL spawn **N=2 additional fresh Verifiers** against the same `(intent_path, claimant)` tuple. The three calls SHALL share a `confirmation_of_trace_id` for post-hoc correlation. The aggregation rule SHALL be: `confirmation_pass_outcome: "confirmed_reject"` if ≥1 of the 2 confirmation Verifiers reject (re-enter Step 4 with the regressed intent in scope); `confirmation_pass_outcome: "flaky_verdict_dismissed"` if both override to accept (continue sampling the remaining rounds). Subsequent rejects in the same round set SHALL NOT fire another confirmation pass. (RFC §6.5; design D5; **P3-T14**, **P3-T15**.)

#### Scenario: Confirmed regression re-enters Step 4 (mechanism)

- **WHEN** the scripted-verdict Verifier double returns `[reject, reject, accept]` on a sampled tuple
- **THEN** two confirmation Verifier calls fire (the double's `spawnCount` advances by 2)
- **AND** all three traces share `confirmation_of_trace_id`
- **AND** the original event records `confirmation_pass_outcome: "confirmed_reject"`
- **AND** a regression report is emitted
- **AND** the bead re-enters Step 4 with the regressed intent added to the active set

#### Scenario: Flaky reject is dismissed (mechanism)

- **WHEN** the scripted-verdict Verifier double returns `[reject, accept, accept]` on a sampled tuple
- **THEN** the original event records `confirmation_pass_outcome: "flaky_verdict_dismissed"`
- **AND** all three traces share `confirmation_of_trace_id`
- **AND** the bead does NOT re-enter Step 4
- **AND** sampling continues to the next round

#### Scenario: Subsequent rejects do not fire additional confirmation passes

- **WHEN** the first round's verdict is `reject` (triggering one confirmation pass), and a later round in the same round set also rejects
- **THEN** the second reject does NOT fire a confirmation pass
- **AND** the later reject is treated as part of the round set's verdict aggregation directly

