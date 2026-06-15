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

### Requirement: The verification channel is a property of the claim, declared by the author, not derived from decoration modality

A triple's verification channel SHALL be resolved from the author-declared `triple.verify` field (`"structural" | "semantic"`) when present, and SHALL fall back to decoration modality (a `<file>.intent` sidecar claimant ⇒ structural) only when `triple.verify` is absent. The channel SHALL NOT be derived from file format alone. A triple decorated INLINE on a comment-bearing file (e.g. a `.ts` config file) that the author marked `verify: structural` SHALL be verified MECHANICALLY by presence (its claimant resolving in the live worktree index) — never routed to the semantic LLM. The Engineer SHALL NOT be able to set or change a triple's channel (it is declared in the version-controlled intent, not in the worktree code the Engineer edits). (RFC §3.3, App. D.11, App. D.30.)

#### Scenario: A comment-bearing config triple marked structural converges with zero model calls

- **WHEN** an intent's triple is decorated inline on a `.ts` config file and the author declared `verify: structural`
- **THEN** the verifier routes it to the structural (mechanical) channel and it passes on presence, converging iteration-1 with no semantic LLM call
- **AND** the verdict carries `channel: "mechanical"`

#### Scenario: An author-declared semantic triple is not swept structural by a whole-file config claim

- **WHEN** a triple is declared `verify: semantic` in an intent that also has a whole-file structural sidecar claim (`aspect_ids: null`)
- **THEN** the triple is classified semantic (the author declaration overrides the modality fallback) and is judged by the semantic Verifier, not vacuously passed as structural

### Requirement: The structural channel honors compose and refuses claims it cannot mechanically verify

`structuralVerdict` and the mixed-intent merge SHALL aggregate per-triple verdicts via the SAME `compose` operator the semantic path uses (`all`/`any`/`none`/`implies`) — never a hardcoded `all`. For `compose: implies`, the structural path SHALL evaluate the deterministic antecedent and vacuously accept when it does not hold. A `verify: structural` triple with `polarity: negative` or with a `quantifier` SHALL be rejected at authoring time (`dusk validate` and the author Stage-4.5 pass), because the structural channel verifies presence/coverage and can witness neither an absence nor a cardinality bound; if such a triple nonetheless reaches `structuralVerdict` it SHALL fail loud, never emit a vacuous pass. (RFC §3.3, App. D.31.)

#### Scenario: A compose: none structural intent rejects when a focal claim holds

- **WHEN** `structuralVerdict` evaluates a `compose: none` intent whose structural triple passes coverage
- **THEN** the intent `decision` is `reject` (not the inverted `accept` a hardcoded-`all` aggregation produced)

#### Scenario: A negative or quantified structural triple is rejected at authoring time

- **WHEN** `dusk validate` (or the author Stage-4.5 pass) encounters a triple with `verify: structural` and `polarity: negative`, or with a `quantifier`
- **THEN** it reports a `verify_channel` violation naming the triple and directing the author to the semantic channel, and the runtime structural verifier fails such a triple loudly rather than passing it on coverage
