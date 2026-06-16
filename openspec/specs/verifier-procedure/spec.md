# verifier-procedure Specification

## Purpose
TBD - created by archiving change phase-2-runtime-verification. Update Purpose after archive.
## Requirements
### Requirement: The Verifier procedure runs the §3.3 steps end-to-end at temperature 0

`packages/runtime/verifier` SHALL implement the full §3.3 procedure per (intent, aspect): (1) resolve focal+support claimants via the derived-index query interface; (2) read scoped evidence (focal lines + each support's location + the inline NL triple); (3) for `compose: implies` intents, evaluate the antecedent group deterministically (§verifier-procedure: Deterministic antecedent); (4) build an affirmative LLM prompt with `quantifier` bound + `scope` annotation; (5) call the LLM at `temperature: 0`; (6) apply runtime polarity inversion to obtain `focal_verdict`; (7) extract per-support `triple_verdict ∈ {matches, mismatch, vague}` and aggregate `support_quality`; (8) aggregate per-`compose` rule into the intent `decision`. The output Verdict SHALL match RFC App. A.4. (RFC §3.2.1, §3.3, App. A.4; design D7–D9; Plan P2-T5–T18.)

#### Scenario: A clean intent on the worked example verifies pass with the full verdict shape

- **WHEN** `dusk_verify` is invoked on the App. B `sendNotification` fixture with no injected defects
- **THEN** every focal triple has `focal_verdict: "pass"`
- **AND** the Verdict shape includes per-triple `focal_verdict`, `support_quality`, `polarity`, evidence with `focal_claim?` + `support_claims[]` carrying `triple_verdict`, optional `support_pass_count`, plus the intent-level `decision` and `aggregate_rationale`

### Requirement: Polarity inversion happens at the runtime boundary; the LLM is never asked a negated question

The Verifier prompt builder SHALL frame every triple as the affirmative question `"In this code, does <subject> <predicate> <object> hold?"` regardless of `polarity`. The LLM SHALL return `pass | fail` on the affirmative claim. The runtime SHALL invert the LLM verdict when `polarity: negative` to produce the final `focal_verdict`, preserving the original `polarity` in `Verdict.per_triple[].polarity` for downstream attribution. Constituent negation inside subject/object noun phrases (§3.1.1) SHALL NOT cause the runtime to reframe a polarity-positive triple as negative. (RFC §3.1, §3.3, App. D.17; design D7; Plan P2-T5.)

#### Scenario: Polarity inversion truth table (2×2)

- **WHEN** the Verifier evaluates a negative-polarity triple against code where the affirmative claim holds
- **THEN** `focal_verdict: "fail"`
- **AND** when the affirmative claim does NOT hold, `focal_verdict: "pass"`
- **AND** the positive-polarity duals yield the inverse mapping (pass↔fail)
- **AND** in every case the captured `raw_prompt` contains no `does NOT` / negation substring

#### Scenario: Constituent negation inside an NP does not reframe the triple

- **WHEN** a negative-polarity triple's object slot carries the constituent-negation phrase `"with no required arguments"`
- **THEN** the affirmative question still poses that NP as positive content, and the runtime applies polarity inversion exactly once

### Requirement: Deterministic antecedent evaluation for `compose: implies` — no LLM call when antecedent false

For `compose: implies` intents, the procedure SHALL evaluate the antecedent group by deterministic index lookup against the closed antecedent vocabulary (`"is decorated with"`, `"claims any aspect of"`, `"is enclosed by a decoration of"`). When the antecedent group is false, the procedure SHALL return `{decision: "accept", implies_antecedent_held: false, per_triple: []}` AND SHALL emit zero `SubAgentTrace` events with `role: "verifier"` for the consequent. When the antecedent group is true, the procedure SHALL run the standard LLM verifier flow on the consequent triples. (RFC §3.2.1, App. A.4, App. D.18; design D4; Plan P2-T6/T7.)

#### Scenario: Antecedent false produces vacuous accept with zero Verifier traces for the consequent

- **WHEN** `dusk_verify` evaluates `api/idempotency-on-writes` (antecedent `"is decorated with api/write-endpoint"`) on a function lacking that decoration
- **THEN** the Verdict has `decision: "accept"`, `implies_antecedent_held: false`, `per_triple: []`
- **AND** no `SubAgentTrace` of `role: "verifier"` is emitted for the consequent
- **AND** the trace stream's antecedent-phase prompt-token sum is `0`

#### Scenario: Antecedent true fires the consequent LLM evaluation

- **WHEN** the same intent is evaluated against a function decorated `api/write-endpoint` but omitting idempotency-key handling
- **THEN** `implies_antecedent_held: true` and the consequent triple's `focal_verdict: "fail"`

### Requirement: All three closed antecedent predicates evaluate by index lookup

The Verifier SHALL evaluate antecedents for **all three** closed predicates — `"is decorated with"`, `"claims any aspect of"`, `"is enclosed by a decoration of"` — by index lookup, with no LLM call in the antecedent phase. The enclosure predicate SHALL resolve to a distinct query that walks file and directory scopes. (RFC §3.2.1; design D4; Plan P2-T6b.)

#### Scenario: Each closed predicate is index-evaluated correctly in both directions

- **WHEN** three `implies` intents are built, one per closed predicate, each evaluated against a unit that holds and one that doesn't
- **THEN** each evaluation produces the correct `implies_antecedent_held` value
- **AND** no `role: "verifier"` trace is emitted in any antecedent phase

### Requirement: A negative-polarity antecedent triple is a set-complement query

When an antecedent triple carries `polarity: negative`, the antecedent evaluation SHALL invert the index-lookup result (a set-complement query), composing polarity and `compose: implies` correctly with no LLM call. (RFC §3.2.1; design D7 composed with D4; Plan P2-T6c.)

#### Scenario: Negative-polarity antecedent reverses the firing sense

- **WHEN** an `implies` intent's antecedent is `{predicate: "is decorated with", object: "api/legacy", polarity: negative}`
- **THEN** a unit **not** decorated `api/legacy` makes the antecedent hold (consequent fires)
- **AND** a unit decorated `api/legacy` makes it false (vacuous accept)
- **AND** no LLM call is made in either case

### Requirement: Ambiguous antecedent is a structural error, never an LLM fallback

When the antecedent's unit-under-evaluation binds ambiguously (e.g., the subject does not uniquely identify the unit being verified), the procedure SHALL return `DuskError { kind: "verifier_evidence_too_large" }` and SHALL NOT fall back to LLM judgement. The "no LLM fallback for antecedents" property protects `must`-level rules from silent vacuous satisfaction. (RFC §3.2.1 ambiguity handling; design D4; Plan P2-T7b.)

#### Scenario: Ambiguous antecedent returns a structural error and never an LLM call

- **WHEN** a verifier call's antecedent subject binds to multiple code units
- **THEN** the Verifier returns `DuskError { kind: "verifier_evidence_too_large", recoverable: ... }`
- **AND** the trace stream records zero LLM calls in the antecedent phase

### Requirement: Per-triple verdict splits focal correctness from support quality

`Verdict.per_triple[]` SHALL contain `focal_verdict: "pass" | "fail"` (drives Engineer re-draft in Phase 3) and `support_quality: "ok" | "low_confidence"` (advisory, never drives re-draft). For each `@intent-support` claim under a triple's evidence, the procedure SHALL elicit a per-claim `triple_verdict ∈ {"matches", "mismatch", "vague"}`. The Verdict aggregation SHALL keep these orthogonal — a `support_quality: low_confidence` SHALL NOT, by itself, fail the focal verdict. (RFC §3.3, App. A.4; design D9; Plan P2-T8.)

#### Scenario: Mismatching support does not fail the focal claim

- **WHEN** code satisfies the focal claim but one `@intent-support` triple misdescribes its statement
- **THEN** the triple's `focal_verdict: "pass"`, `support_quality: "low_confidence"`
- **AND** that claim's `triple_verdict: "mismatch"`

#### Scenario: A real focal defect fails regardless of pristine supports

- **WHEN** code has a real focal defect but every support triple accurately describes its statement
- **THEN** the triple's `focal_verdict: "fail"`, `support_quality: "ok"`

#### Scenario: Vague supports surface as triple_verdict from the model

- **WHEN** code carries an `@intent-support` whose NL triple is underspecified relative to its statement
- **THEN** the Verdict reports that claim's `triple_verdict: "vague"`

### Requirement: `support_quality` aggregation is a pure deterministic rule

`support_quality` SHALL be computed by a pure function over per-claim `triple_verdict[]`: `any "mismatch" → "low_confidence"`; otherwise `(count_of_vague / total_supports) ≥ 0.5 → "low_confidence"`; otherwise `"ok"`. The function SHALL be implementation-tested in isolation (unit-only). (RFC §3.3, App. A.4; design D9; Plan P2-T9.)

#### Scenario: Aggregation rule table

- **WHEN** the inputs are enumerated triple-verdict mixes
- **THEN** the outputs match: `[matches,matches]→ok`; `[matches,mismatch]→low_confidence`; `[vague,vague,matches,matches]→low_confidence`; `[vague,matches,matches]→ok`; `[]→ok`

### Requirement: Scoped reading reads focal + named-support evidence only

For a given `(intent, aspect)` the assembled evidence SHALL include only the focal claimants' source lines and the support claimants' source lines (with their inline NL triples) — never the full file body. The procedure SHALL cap total assembled evidence at `dusk.config.yml > verifier_evidence_max_lines` (default 200) and SHALL return `DuskError { kind: "verifier_evidence_too_large" }` on overflow without silent truncation. (RFC §3.3, §4.2; design D8; Plan P2-T10.)

#### Scenario: Verifier input contains only the aspect's claimant lines

- **WHEN** `notifications/send [publish-sync-per-insert]` is verified against the App. B fixture
- **THEN** the Verifier's input contains the publish line plus the loop / timestamp / event-payload supports
- **AND** the Verifier's input does NOT contain the opt-out, push-dispatch, or error-handling lines

#### Scenario: Evidence overflow returns a structural error

- **WHEN** the assembled evidence exceeds `verifier_evidence_max_lines`
- **THEN** the procedure returns `DuskError { kind: "verifier_evidence_too_large" }` and does not call the LLM

### Requirement: Quantifier cardinality is enforced explicitly, including ≤-direction and scope binding

The Verifier SHALL evaluate `quantifier` against the matching occurrence count within the named `scope` — never parsing cardinality from English. The vocabulary covers `at-least-one` (default), `each`, `exactly-one`, `at-most-one`, `none`, `at-least-N`, `at-most-N`. (RFC §3.1, §3.3; Plan P2-T15/T15b/T15c.)

#### Scenario: `exactly-one` per-row scope rejects double-publish and accepts single-publish

- **WHEN** a triple `{quantifier: exactly-one, scope: "per inserted notification row"}` is verified against code publishing twice per row
- **THEN** `focal_verdict: "fail"`
- **AND** the same triple against code publishing once per row yields `focal_verdict: "pass"`

#### Scenario: The ≤-direction family is enforced

- **WHEN** quantifiers `none`, `at-most-one`, `at-most-2` are evaluated at and around their bounds
- **THEN** `none` rejects on any matching occurrence; `at-most-one` rejects on 2; `at-most-2` accepts on 2 and rejects on 3

#### Scenario: `scope` binds — same code, different scope, different verdict

- **WHEN** the same code is evaluated against two intents differing only by `scope` (`exactly-one "per row"` vs `exactly-one "per request"`)
- **THEN** the two evaluations yield different verdicts (the bound is evaluated against the named scope)

### Requirement: `compose` aggregation combines per-triple verdicts correctly

The intent-level `decision` SHALL aggregate per-triple verdicts per the `compose` mode: `all` rejects if any focal fails; `any` accepts if at least one focal passes; `none` rejects if any focal claim *holds*; `implies` accepts vacuously when the antecedent group is false, otherwise reduces to `all` over consequents. (RFC §3.2, App. A.4; Plan P2-T16.)

#### Scenario: All four compose modes agree with their truth tables

- **WHEN** the same set of per-triple verdicts is aggregated under `all`, `any`, `none`, and `implies` (with antecedent both true and false)
- **THEN** each mode's `decision` matches its specified truth table

### Requirement: For `compose: implies`, the Verifier prompt presents only consequents

When the antecedent is true and the consequent flow runs, the assembled Verifier prompt SHALL present the consequent triples for judgement and SHALL NOT present the antecedent triples. This is a structural property of the assembled payload (consequent triples present; antecedent triples absent), independent of prompt wording. (RFC §3.2.1, §9.5; design D7; Plan P2-T17.)

#### Scenario: An antecedent-true implies intent's raw_prompt carries consequents only

- **WHEN** the captured `raw_prompt` for a consequent evaluation is inspected
- **THEN** the consequent triples appear as the triples to judge
- **AND** the antecedent triples do not appear in the triples-to-judge structure

### Requirement: Passing supports are summarized as a count by default

The Verdict SHALL enumerate failed and low-confidence supports in `support_claims[]` and SHALL summarize the count of passing supports as `support_pass_count` when verbose enumeration is not requested. This keeps trace volume bounded. (RFC §3.3, App. A.4; Plan P2-T18.)

#### Scenario: An accurate-supports verdict reports a count, not enumeration

- **WHEN** an aspect with multiple accurate supports is verified at the default verbosity
- **THEN** `support_pass_count` is present
- **AND** `support_claims[]` enumerates only failing or low-confidence claims

### Requirement: Structural (comment-less) records are excluded from the semantic path at the index boundary

A `DecorationRecord` tagged `verify: "structural"` (comment-less sidecar records) SHALL be excluded from the semantic path at the **derived-index boundary** — not merely from the assembled prompt. Because the shared scanner routes structural records into `buildDerivedIndex`, and the satisfaction-bearing functions key on `marker`/`scope` alone (a sidecar's `intent`/`intent-file` marker is a focal marker), a prompt-only exclusion would let a structural claim mark a semantic intent's aspects **satisfied** or satisfy a `compose: implies` antecedent — blending config into semantic adherence. Therefore `verify: "structural"` records SHALL be excluded from **all four** semantic consumers: `focalSupport`, `aspectRollup`, `isSatisfied`, AND the `compose: implies` antecedent gate (`packages/runtime/verifier/src/antecedent.ts`, which reads `index.records` raw with its own focal-marker + `scope:"file"`/`"directory"` predicates). The recommended mechanism is a **semantic-only record set** exposed by `buildDerivedIndex` that those four consume. The public `DerivedIndex.records` field SHALL remain the **full** merged set — structural records MUST stay visible to the reverse-index, `dusk_inspect`, and `dusk doctor` (the keystone's purpose); narrowing `records` to semantic-only would re-hide them and undo the keystone. Such records carry no architectural triple to judge; their "satisfaction" is the mechanical coverage pass — the anchor resolves, coverage tiles, Stage-2 passes — surfaced via the gate result and the `dusk doctor` coverage report (no separate per-record verdict object). The semantic Verifier's behavior for `verify: "semantic"` records is unchanged. (RFC App. D.28; design D6/D8.)

#### Scenario: A config sidecar claim is not sent to the semantic Verifier

- **WHEN** the Verifier procedure assembles evidence for a run that includes `verify: "structural"` sidecar records
- **THEN** those records are not included in the semantic prompt

#### Scenario: A structural claim does not flip a semantic aspect to satisfied

- **WHEN** a `verify: "structural"` sidecar claim names an `intent_path` whose intent has unsatisfied aspects, and `aspectRollup`/`isSatisfied` are computed
- **THEN** that intent's aspects are NOT marked satisfied by the structural claim (the structural record is absent from the semantic record set the rollup consumes)
- **AND** the intent's semantic satisfaction is identical to what it would be with no sidecar present

#### Scenario: A structural claim does not satisfy a `compose: implies` antecedent

- **WHEN** a `compose: implies` intent's antecedent could be satisfied only by a `verify: "structural"` sidecar claim (e.g. `"is enclosed by a decoration of"` against a `scope:"file"` structural record)
- **THEN** the antecedent gate (`antecedent.ts`) does NOT treat it as satisfied (structural records are absent from the semantic record set it evaluates)

#### Scenario: Structural records remain visible to non-semantic consumers after the partition

- **WHEN** the semantic/structural partition is in effect and a structural sidecar record exists
- **THEN** that record is still returned by `reverse(file)`, still appears in the `dusk_inspect` claims list, and is still seen by the `dusk doctor` coverage pass (the public `records` set remains full — the keystone is preserved)

