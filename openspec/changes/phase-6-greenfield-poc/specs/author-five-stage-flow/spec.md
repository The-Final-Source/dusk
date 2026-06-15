## ADDED Requirements

### Requirement: Stage 2 detects an unmet foundation / prerequisite gap and steers foundation-first authoring

Stage-2 tension detection SHALL run in both directions: against intents that *exist* (the conflict/overlap/gray/adjacent classes) AND against intents that *should exist but do not* — the **foundation gap**. The runtime SHALL supply the Author a deterministic `foundation` signal alongside the grep candidates: the census of existing intent paths plus an `empty_tree` flag (true when `.ia/intents/` holds no intents — the greenfield-first-intent case). When the requested behavior intent presupposes foundational intents/decisions absent from the tree (project/tech-stack setup, module structure, app bootstrap, the persistence layer — unconditionally when `empty_tree` is true), the Author SHALL surface this in its Stage-2 question and recommend authoring the prerequisite foundation intents **first**, in dependency order (project/stack → bootstrap → persistence → behavior), rather than silently drafting a behavior intent that would force the implementation pipeline to birth the whole application inside one bead. This is the proactive authoring-time complement to the Decomposer's reactive mid-`dusk_implement` missing-intent pause (App. D.10). It is a **dialog-agent** responsibility — the 9-step pipeline gains no greenfield special-case; the foundation is simply the project's first intents. (RFC §5, §8.2; App. D.24, D.25.)

#### Scenario: An empty tree yields a foundation-gap signal

- **WHEN** the Author runs Stage-2 discovery against a `.ia/intents/` tree with no intents
- **THEN** the `foundation` signal carries `empty_tree: true` and an empty census
- **AND** the signal is supplied to the Author generator alongside the grep candidates

#### Scenario: A populated tree carries the census and is not an automatic gap

- **WHEN** the Author runs Stage-2 discovery against a tree that already contains intents
- **THEN** the `foundation` signal carries `empty_tree: false` and the sorted census of existing intent paths
- **AND** the Author judges from the census whether the specific presupposed foundation is present

#### Scenario: The foundation-gap detection is a dialog responsibility, not a pipeline phase

- **WHEN** a behavior intent presupposing an absent foundation is authored
- **THEN** the gap is surfaced and resolved through the authoring dialog (author the foundation intents first)
- **AND** no synthesized foundation bead, bootstrap spawn, or canonical foundation Block is introduced into the pipeline
