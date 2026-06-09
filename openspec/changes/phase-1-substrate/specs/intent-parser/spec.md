## ADDED Requirements

### Requirement: Intent files round-trip losslessly and atomically

`packages/core/parser` SHALL read `intent.yaml` into a validated Intent and write an Intent back in canonical, deterministic form (stable field ordering; triples ordered by id), such that parse→write→parse preserves meaning. Writes MUST be atomic (temp file + rename) so a crash never leaves a partial file. (Plan P1-T2, P1-T20; RFC §2.1.)

#### Scenario: Authored intent round-trips losslessly

- **WHEN** an intent with quantifiers, polarity, and typed edges is parsed, written, and re-parsed
- **THEN** the re-parsed Intent is structurally equal and triple ordering is stable

#### Scenario: Interrupted write never corrupts the file

- **WHEN** a write fails between the temp-write and the rename
- **THEN** the on-disk `intent.yaml` is either the complete prior version or the complete new version, never a partial one
- **AND** the next validation reads a valid file

### Requirement: Negation detection follows the matrix/constituent rule

The parser SHALL include a POS-aware `negation-detector` (no ML dependency) implementing RFC §3.1.1: matrix-predicate negation (the closed lexicon) is rejected in a triple's `predicate` slot; constituent negation inside a subject/object noun phrase is legal. (Plan P1-T3.)

#### Scenario: Matrix-predicate negation in a predicate slot is rejected

- **WHEN** a predicate slot contains a matrix-negation marker (e.g. "does not return", "lacks", "fails to")
- **THEN** the parser rejects it with a hint to author `polarity: negative` instead

#### Scenario: Constituent negation inside a noun phrase is allowed

- **WHEN** a subject or object slot contains a constituent-negation noun phrase (e.g. "a function with no required arguments")
- **THEN** the parser accepts it

### Requirement: implies antecedent grammar is validated at load

For `compose: implies` intents the parser SHALL reject antecedent triples outside the closed predicate vocabulary or with unresolvable references, raising `decoration_parse_error` that points to the implies-antecedent-grammar guidance, per RFC §3.2.1. (Plan P1-T4.)

#### Scenario: Behavioral or type-system antecedent is rejected

- **WHEN** an implies intent's antecedent uses a behavioral or type-system predicate (e.g. "performs a database write", "returns Promise<T>")
- **THEN** the parser rejects it with `decoration_parse_error`

#### Scenario: Decorator-fact antecedent is accepted

- **WHEN** the antecedent uses "is decorated with <intent-path>" against a resolvable reference
- **THEN** the intent validates
