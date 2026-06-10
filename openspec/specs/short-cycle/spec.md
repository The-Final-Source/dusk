# short-cycle Specification

## Purpose
TBD - created by archiving change phase-3-implementation-pipeline. Update Purpose after archive.
## Requirements
### Requirement: The short cycle drives the Engineer ↔ Verifier loop within an entry ceiling and a lifetime budget

`packages/runtime/short-cycle` SHALL implement Step 4 of the 9-step pipeline. The Bead Orchestrator SHALL spawn a persistent Engineer (`memory: bead`) and, on each iteration, run gate→Verifier per RFC §6.4: Engineer drafts → PreToolUse gate → on pass, spawn fresh Verifier (`memory: none`, payload identical across iterations) → on `focal_verdict: pass` exit cycle, on `focal_verdict: fail` re-draft. The cycle SHALL respect two distinct budgets read from `dusk.config.yml`: a per-entry ceiling (`sanity.short_cycle_max_iterations`, default 20) and a bead lifetime budget across all Step-4 entries (`sanity.bead_lifetime_iterations`, default 40). Tests SHALL assert the *relationship* `lifetime > per-entry`, not the literal values. (RFC §6.4; design D12; **P3-T25**.)

#### Scenario: Per-entry ceiling and lifetime budget are distinct, configurable, and asserted as a relationship

- **WHEN** a fixture config sets `sanity.short_cycle_max_iterations: 4` and `sanity.bead_lifetime_iterations: 6`, and the scripted-verdict Verifier double drives a bead that hits the per-entry ceiling, exits via long-cycle bounce-back, and re-enters Step 4
- **THEN** the per-entry counter resets at the second entry
- **AND** the lifetime counter continues across entries
- **AND** the recovery ladder fires when the lifetime counter reaches 6, NOT when the per-entry counter reaches 4 in the second entry
- **AND** `sanity.bead_lifetime_iterations > sanity.short_cycle_max_iterations` (the relationship, not the literals)

### Requirement: Gate-fail loopback re-drafts without spawning a Verifier

When the PreToolUse gate rejects an Engineer draft, the rejection SHALL be routed back to the Engineer for re-draft without spawning the Verifier for that iteration. The Verifier SHALL be spawned ONLY on iterations where the gate has approved the draft. (RFC §6.4 steps d–e; **P3-T24**.)

#### Scenario: Blocked draft does not emit a Verifier trace

- **WHEN** the Engineer emits an undecorated statement that the PreToolUse gate rejects
- **THEN** the rejection reaches the Engineer's next-iteration input
- **AND** no `SubAgentTrace` with `role: "verifier"` is emitted for the blocked iteration
- **AND** the Verifier double's `spawnCount` does not advance for that iteration

### Requirement: The stuckness detector fires the convergence diagnosis as early as iter 3

The Bead Orchestrator SHALL evaluate a stuckness predicate after each Verifier verdict on iter ≥ 3 using the trace stream's `verdict_delta_from_prior` + derived `failing_triple_set`. The predicate SHALL fire when, across iters `K-2, K-1, K`, `verdict_delta_from_prior == ∅` AND `failing_triple_set` is identical. On match, the Engineer SHALL write `## Current diagnosis` to bead memory before the next iteration's draft, and the Bead-Orchestrator trace SHALL carry `stuckness_detector_state.fired: true`. (RFC §6.4.2; design D6; **P3-T8**.)

#### Scenario: Three iters of identical failing-triple sets fire the diagnosis at iter 3

- **WHEN** the scripted-verdict Verifier double drives iters 3–5 so they share `verdict_delta_from_prior == ∅` AND identical `failing_triple_set`
- **THEN** exactly one `## Current diagnosis` block is written to bead memory at iter 3
- **AND** the Bead-Orchestrator trace at iter 3 carries `stuckness_detector_state.fired: true`
- **AND** no Verifier trace's `raw_prompt` contains any substring of the written diagnosis text (the structural no-leak invariant)

#### Scenario: Stuckness derivation is wired against real verdicts on a stalling fixture

- **WHEN** the real frontier-model Verifier is run at `temperature: 0` against a genuinely-stalling fixture (an intent the Engineer cannot satisfy through several drafts)
- **THEN** `failing_triple_set` is derived from the real Verifier verdicts and the detector fires when the predicate matches (proving the upstream derivation is wired, not just the predicate)

### Requirement: The iter-5 fallback fires the diagnosis when stuckness has not

If the stuckness detector has not fired by the end of iter 5 and convergence has not been reached, the Engineer SHALL be forced to write `## Current diagnosis` to bead memory at iter 5 unconditionally. (RFC §6.4; **P3-T9**.)

#### Scenario: Moving failing-triple set still triggers a diagnosis at iter 5

- **WHEN** the scripted-verdict Verifier double drives a bead whose `failing_triple_set` changes each iter (stuckness never fires) and convergence has not occurred by iter 5
- **THEN** exactly one `## Current diagnosis` block is written to bead memory at iter 5
- **AND** the diagnosis is not written before iter 5

### Requirement: Iter-15 early escalation surfaces the diagnosis as the escalation payload

If convergence has not occurred by iter 15 within a single Step-4 entry, the Bead Orchestrator SHALL surface an early escalation to the user/harness whose payload IS the bead-memory diagnosis (read from `## Current diagnosis`, not from any Verifier-visible state). The escalation SHALL distinguish itself from a recovery-ladder error (the user is being asked for input, not informed of a terminal state). (RFC §6.4; **P3-T10**.)

#### Scenario: 15 non-converging iters surface the diagnosis to the user

- **WHEN** the scripted-verdict Verifier double drives 15 non-converging iters
- **THEN** an early-escalation event is emitted whose payload contains the diagnosis text from bead memory
- **AND** the event is distinct from any `bead_*` recovery-ladder error

### Requirement: `support_quality: low_confidence` does NOT trigger Engineer re-draft

The short-cycle loop SHALL treat `support_quality: low_confidence` as advisory only — it MUST NOT cause the bead to re-enter Step 4. Only `focal_verdict: fail` on at least one triple SHALL trigger re-draft. The low-confidence signal SHALL surface in the run summary and via `dusk_inspect`'s `low_confidence_supports[]` field. (RFC §6.4 loop note, §3.3; design D6 verdict-split consequence; **P3-T29**.)

#### Scenario: Low-confidence support converges without re-draft

- **WHEN** the scripted-verdict Verifier double returns `focal_verdict: pass` + `support_quality: low_confidence` for every triple
- **THEN** the bead exits Step 4 and proceeds to Step 5 (does NOT re-enter Step 4)
- **AND** the iteration counter does not increment for the support signal
- **AND** the low-confidence support appears in the run summary as advisory
- **AND** `dusk_inspect` for that intent lists the support under `low_confidence_supports[]`

### Requirement: The Verifier spawn payload carries no iteration-specific or diagnosis content

Each iteration's Verifier spawn SHALL produce an assembled `raw_prompt` (test-mode only) that contains no iteration number, no prior verdict content, no `## Current diagnosis` text from bead memory, and no other iteration-distinguishing field. The structural no-leak invariant SHALL be mechanically checked in-run. (RFC §6.4, §9.2; **P3-T8** structural part.)

#### Scenario: Verifier raw_prompt contents are identical across iterations modulo the diff

- **WHEN** a multi-iteration Step-4 entry runs in test mode
- **THEN** the captured `raw_prompt` for the Verifier spawn at iter N contains no token sequence appearing only at iters ≠ N (no iter counters, no prior `focal_verdict` text, no diagnosis substrings)

