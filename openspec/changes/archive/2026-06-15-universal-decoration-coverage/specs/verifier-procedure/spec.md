## ADDED Requirements

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
