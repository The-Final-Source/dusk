# intent-schema Specification

## Purpose
TBD - created by archiving change phase-1-substrate. Update Purpose after archive.
## Requirements
### Requirement: Intent schema is Zod-defined and authoritative

The system SHALL define the Intent, Triple, ComposeRule, RelatesTo, and antecedent-triple shapes as Zod schemas in `packages/core/schema` — the single source of truth, with TS types derived via `z.infer` (never duplicated) — per RFC §2.1, §3.1–3.2, App. A.1. An Intent MUST carry `{ id, description, obligation (must|should|may), compose (all|any|none|implies), triples | (antecedent + consequent), relates_to[] }`. A Triple's `subject`/`predicate`/`object` slots MUST be affirmative English; structural negation is the `polarity: positive|negative` field (default positive); `quantifier` and `scope` are optional. The Intent `id` MUST equal the slash-namespaced path from `.ia/intents/` to its directory.

#### Scenario: Valid intent validates

- **WHEN** an intent.yaml with affirmative triples, polarity/quantifier/scope, `compose`, and typed `relates_to` is loaded
- **THEN** it validates against the schema and exposes the inferred Intent type

#### Scenario: Path-to-id mismatch is rejected

- **WHEN** an intent's `id` does not equal its directory path under `.ia/intents/`
- **THEN** validation fails with a `file:line` error and the intent is not accepted

#### Scenario: implies antecedent is restricted to the closed vocabulary

- **WHEN** a `compose: implies` intent declares an antecedent triple whose predicate is outside the closed set ("is decorated with", "claims any aspect of", "is enclosed by a decoration of")
- **THEN** validation fails with `decoration_parse_error` referencing the implies-antecedent-grammar guidance
- **AND** an antecedent using the closed vocabulary against a resolvable reference validates

### Requirement: Older intent corpora migrate forward automatically

The loader SHALL read older `schema_version` corpora and migrate them to the current schema without authoring intervention, per RFC App. C: `negated: true → polarity: negative`, flat `relates_to: [string] → [{kind: sibling, target}]`, and `kind: refines → kind: parent`, each emitting a deprecation warning. (Plan P1-T1.)

#### Scenario: Legacy corpus migrates with deprecation warnings

- **WHEN** an intent carrying `negated: true`, a flat `relates_to` list, and a `kind: refines` edge is loaded
- **THEN** the resolved Intent exposes `polarity: negative`, `{kind: sibling}`, and `{kind: parent}` respectively
- **AND** a deprecation warning is surfaced for each migrated construct

