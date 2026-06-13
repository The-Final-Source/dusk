# ecosystem-skeletons Specification

## Purpose
TBD - created by archiving change phase-5-validation-benchmark-dogfood. Update Purpose after archive.
## Requirements
### Requirement: The registry router ships three routable tRPC procedures in the existing packages/api

`packages/api` SHALL gain a `registry` tRPC router (new router + service per the repo's platform-distribution conventions — never a new `platform/` package) with exactly three Zod-validated procedures: `searchCanonicalIntents` (name/description substring search over `packages/intents/canonical/`), `getCanonicalIntent` (one canonical intent's parsed content by path), and `getAdherenceSummary` (hierarchical satisfaction for a named decorated package, computed on demand from the derived index — no adherence DB). Each SHALL return a schema-valid non-error response against the dogfooded `packages/shared`. Existing routes and behavior SHALL be unchanged; `packages/api`'s existing test suite SHALL stay green. (Roadmap Sprint 10; design D9; **P5-T14** api half.)

#### Scenario: Registry routes respond with structured data

- **WHEN** `searchCanonicalIntents`, `getCanonicalIntent`, and `getAdherenceSummary` are each invoked against a repo with canonical intents and the decorated `packages/shared`
- **THEN** each returns a Zod-schema-valid non-error response with real data

#### Scenario: Existing api behavior is untouched

- **WHEN** `packages/api`'s pre-existing test suite runs after the router lands
- **THEN** every pre-existing test passes unchanged

### Requirement: Three web views render against a decorated package in the existing packages/web

`packages/web` SHALL gain three views — **Adherence** (per-intent satisfaction rollup), **Intent tree** (the hierarchical intent graph), and **Decoration coverage** (decorated-vs-undecorated unit counts per file) — each rendering data from the registry router for a decorated package. "Routable/renderable, not feature-complete" is the bar: each view loads without runtime errors and displays the data; pagination, auth-surface changes, editing, and live updates are explicitly OUT. Existing views SHALL be unchanged; `packages/web`'s existing test suite SHALL stay green. (Roadmap Sprint 10; design D9; **P5-T14** web half.)

#### Scenario: The three views render with real data

- **WHEN** the Adherence, Intent-tree, and Decoration-coverage views are rendered against the dogfooded `packages/shared`'s index data
- **THEN** each loads without runtime errors and displays the package's data

#### Scenario: Feature-completeness is explicitly out of scope

- **WHEN** the views are inspected for the excluded surfaces
- **THEN** no pagination, no auth-surface change, no editing capability, and no live-update machinery is present

#### Scenario: Existing web behavior is untouched

- **WHEN** `packages/web`'s pre-existing test suite runs after the views land
- **THEN** every pre-existing test passes unchanged

