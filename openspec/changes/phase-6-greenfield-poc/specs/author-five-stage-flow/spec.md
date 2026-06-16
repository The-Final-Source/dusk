## ADDED Requirements

### Requirement: Stage 2 detects an unmet dependency as a general `prerequisite` tension

Stage-2 tension detection SHALL run in both directions: against intents that *exist* (the conflict/overlap/gray/adjacent classes) AND against an intent the request *depends on but that does not exist in the tree* — a fifth, general classification, **`prerequisite`**. The runtime SHALL supply the Author a general `intent_census` (the set of intent paths currently in the tree, and whether it is empty) so its judgment is grounded. When the request plainly requires a capability/decision no intent provides (e.g. an endpoint depending on a not-yet-authored persistence or auth intent), the Author SHALL surface a `prerequisite` tension whose `target` is the missing intent's proposed path and recommend authoring the dependency first. The greenfield foundation (an empty/near-empty census: project/stack, app bootstrap, persistence not yet authored) is the **canonical instance** of a `prerequisite`, not a special mode. A `prerequisite` SHALL be an ordinary surfaced tension (a non-empty `tensions[]`) handled by the existing transition — there SHALL be **no bootstrap-specific state, signal, or branch in the orchestration flow** (App. D.24); the dependency is resolved through the normal authoring dialog, not a pipeline phase. (RFC §5, §8.2; App. D.24, D.25.)

#### Scenario: The tension vocabulary includes `prerequisite`

- **WHEN** the Stage-2 tension classification vocabulary is read
- **THEN** it contains `prerequisite` alongside `conflict`, `overlap`, `gray`, and `adjacent`

#### Scenario: An empty intent tree yields an empty census the Author reasons over

- **WHEN** the Author runs Stage-2 discovery against a `.ia/intents/` tree with no intents
- **THEN** the `intent_census` reports `is_empty: true` and an empty path list
- **AND** the census is supplied to the Author generator alongside the grep candidates

#### Scenario: A populated tree reports the sorted census

- **WHEN** the Author runs Stage-2 discovery against a tree that already contains intents
- **THEN** the `intent_census` reports `is_empty: false` and the sorted list of existing intent paths

#### Scenario: A prerequisite is resolved through the dialog, not the pipeline

- **WHEN** the request depends on an intent absent from the census
- **THEN** the Author surfaces a `prerequisite` tension and steers authoring the dependency first
- **AND** no synthesized foundation bead, bootstrap spawn, canonical foundation Block, or bootstrap branch is introduced into the orchestration flow
