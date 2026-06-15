## ADDED Requirements

### Requirement: Structural triples are satisfied on a mechanical channel, never by the semantic LLM

A triple whose focal claimant is a per-file `<file>.intent` sidecar record (`verify: "structural"`, App. D.28) SHALL be satisfied by a zero-LLM **structural Verifier** (`packages/runtime/verifier/src/structural.ts`), not by the semantic LLM Verifier. For each such triple the structural Verifier SHALL emit `focal_verdict: "pass"` iff the sidecar anchor resolves against the live target AND the target is fully decoration-covered, and `focal_verdict: "fail"` (with an actionable rationale) when the anchor is dangling, a non-trivial line is uncovered, or the triple has no structural claimant at all. It SHALL reuse the same coverage primitives as the pre-tool-use gate (`parseFileIntentSidecar` + `computeSidecarCoverage`) so the gate and the Verifier can never disagree on coverage. Every per-triple verdict it emits SHALL carry `channel: "mechanical"`. (RFC §3.3, App. D.28, App. D.29.)

#### Scenario: An all-structural config intent converges on the first iteration with zero model calls

- **WHEN** `dusk implement` verifies an intent whose every triple is claimed only by `<file>.intent` sidecar records, and the produced config files are fully covered with resolving anchors
- **THEN** every triple has `focal_verdict: "pass"` with `channel: "mechanical"`, the intent `decision` is `accept`, and the short cycle converges without re-drafting
- **AND** no semantic LLM Verifier call is made for that intent

#### Scenario: A structural triple whose anchor no longer resolves fails mechanically

- **WHEN** a sidecar claim's JSON Pointer does not resolve against its target, or a non-trivial target line is covered by no claim or `@intent-ignore`
- **THEN** the structural Verifier emits `focal_verdict: "fail"` for the affected triple with a rationale naming the target and the failing anchor or line

#### Scenario: A triple with no structural claimant fails rather than silently passing

- **WHEN** the structural Verifier evaluates an intent triple that has no structural focal claimant
- **THEN** that triple's `focal_verdict` is `"fail"` with a rationale that the aspect is uncovered by any `<file>.intent` sidecar

### Requirement: The verifier routes by channel; mixed intents combine structural and semantic per triple

The `verifierFactory` SHALL classify an intent's triples via the derived-index `structuralAspects` / `semanticAspects` queries and route accordingly: an **all-structural** intent SHALL be judged solely by the structural Verifier; an **all-semantic** intent SHALL be judged by the unchanged semantic `verifyIntent` flow; a **mixed** intent SHALL run both and merge per `triple_id` such that a triple claimed both ways passes only if it passes BOTH channels, a structural-only triple takes the structural verdict, and a semantic-only triple takes the semantic verdict. The per-triple `channel` field (`"mechanical" | "semantic"`, additive and defaulting to `"semantic"` when absent) SHALL record which channel produced each verdict, and adherence reporting SHALL NOT blend the two channels. The short-cycle convergence loop and the semantic Verifier path SHALL remain unchanged. (RFC §3.3, App. D.29.)

#### Scenario: A mixed intent requires a both-ways triple to pass both channels

- **WHEN** an intent has a triple claimed by both an inline `@intent` record and a `<file>.intent` sidecar record
- **THEN** the merged verdict marks that triple `pass` only if both the structural and the semantic channel pass it, and `fail` (reported on the `semantic` channel) otherwise

#### Scenario: Structural-only and semantic-only triples each take their own channel

- **WHEN** a mixed intent has one structural-only triple and one semantic-only triple
- **THEN** the structural-only triple takes the structural verdict with `channel: "mechanical"` and the semantic-only triple takes the semantic verdict with `channel: "semantic"`
