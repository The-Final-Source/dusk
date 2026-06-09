# intent-graph Specification

## Purpose
TBD - created by archiving change phase-1-substrate. Update Purpose after archive.
## Requirements
### Requirement: The intent graph resolves hierarchy and typed edges

`packages/core/graph` SHALL load every `intent.yaml` under `.ia/intents/`, resolve each to its hierarchical id, support upward (parents) and downward (descendants) traversal, and resolve the five typed `relates_to` kinds — parent, implies, conflicts, supersedes, sibling — per their RFC §2.1 semantics. (Plan P1-T7.)

#### Scenario: Upward and downward traversal

- **WHEN** an intent with parents and descendants is queried
- **THEN** the graph returns its ancestors (via `kind: parent` plus path segments) and its descendants

#### Scenario: Typed edges are resolved per kind

- **WHEN** intents declare parent / implies / conflicts / supersedes / sibling edges
- **THEN** each edge is recorded with its kind for downstream Decomposer and Author use

### Requirement: Cycle detection on relates_to edges

The graph SHALL detect cycles across `relates_to` edges of any kind and report them naming the participating intents. (Plan P1-T7.)

#### Scenario: Cyclic graph is rejected

- **WHEN** intents form a `relates_to` cycle (e.g. A parent B, B sibling A)
- **THEN** the graph load surfaces a cycle error naming both intents

### Requirement: Test-pyramid children resolution

Given an intent `X`, the graph SHALL resolve `X/<suffix>` for each suffix configured in `dusk.config.yml > test_pyramid.suffixes` as a test-pyramid child of `X`.

#### Scenario: Configured suffix resolves as a child

- **WHEN** `X/unit-tests` exists and `unit-tests` is a configured suffix
- **THEN** the graph resolves it as a test-pyramid child of `X`

