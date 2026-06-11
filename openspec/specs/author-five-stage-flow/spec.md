# author-five-stage-flow Specification

## Purpose
TBD - created by archiving change phase-4-intent-authoring. Update Purpose after archive.
## Requirements
### Requirement: The 5-stage flow is implemented as a pure typed transition function

`packages/runtime/author` SHALL expose a pure transition function `(state: DialogState, response: UserResponse) → { nextState: DialogState; outcome: TransitionOutcome }` per design D1. Each stage 1–5 plus 4.5 SHALL have its own transition handler. The transition SHALL be pure (no I/O); the runtime wraps it with LLM calls (to generate `next_question` text) and persistence (to write `nextState` to disk). (RFC §5; design D1.)

#### Scenario: Pure transition is unit-testable against an injected state

- **WHEN** the transition function is called with a synthesized `DialogState` and a `UserResponse` (no real LLM, no fs)
- **THEN** the returned `nextState` reflects the response per the stage's documented branching rules

### Requirement: The continuation pattern walks Stages 1 → 2 → 3 → 4 → 4.5 → 5 with each user decision a real branching point

`dusk_author_start({request})` SHALL produce a `DialogState` at Stage 1 and an `outcome.question` framing the request. Each subsequent `dusk_author_continue` call SHALL advance the dialog through the stages based on the user's response, with every branching decision exposed as the next `next_question` per RFC §5: Stage 1 framing-confirm-or-correct; Stage 2 tension-resolution pick (one per surfaced tension); Stage 3 practice-proposal accept/reject/selective-accept; Stage 4 pyramid-layer pick + drafting confirmation; Stage 5 finalize. (RFC §5; design D1; **P4-T1**.)

#### Scenario: A scripted full-flow run advances through every stage

- **WHEN** scripted Author responses drive `dusk_author_start` + N×`dusk_author_continue` answering each branching decision (framing confirm, tension pick, proposal accept, pyramid pick, draft confirm)
- **THEN** each response advances the dialog to the next stage and surfaces the next stage's `next_question`
- **AND** `dusk_author_finalize` ultimately returns `intents_created[]`

### Requirement: Stage 1 framing-loopback stays at Stage 1 on user correction

When the user's Stage 1 response is a correction (rather than a confirmation), the transition SHALL stay at Stage 1 with a regenerated framing question rather than advance to Stage 2. (RFC §5 Stage 1; **P4-T11**.)

#### Scenario: A rejected framing regenerates without advancing

- **WHEN** Stage 1's framing is presented and the user's response is a correction
- **THEN** `dusk_author_continue` returns a regenerated framing as the next question
- **AND** `current_stage` remains 1
- **AND** the dialog does NOT advance to Stage 2

### Requirement: Stage 2 discovery surfaces tensions via agent-driven grep, no vector search

Stage 2 SHALL execute a grep pass (ripgrep over `intent.yaml` files under `.ia/intents/` — description + triple slot content) against the request's framing keywords, classify each match `conflict | overlap | gray | adjacent` via a frontier-model classification call, and surface each classified tension to the user with resolution options as the next `next_question`. NO vector search, NO embedding substrate, NO RAG layer SHALL be invoked. (RFC §5 Stage 2, §8.10; design Q1; **P4-T2**.)

#### Scenario: Stage 2 finds and classifies an overlap via grep

- **WHEN** an existing `api/pagination/cursor-only` intent is present, and a new cursor-pagination intent is being authored
- **THEN** Stage 2's grep pass finds the existing intent
- **AND** the response surfaces it with a classification (`conflict | overlap | gray | adjacent`) and resolution options
- **AND** the user's resolution pick is encoded into the drafted set in `intents_drafted[]`
- **AND** no embedding/vector substrate is invoked

### Requirement: Stage 3 takes the greenfield branch when the practice proposal is rejected

When the user's Stage 3 response is a rejection of the proposed industry-practice decomposition, the transition SHALL advance to Stage 4 with NO scaffolding — Stage 4 drafts from the user's Stage 1 framing alone. The runtime SHALL NOT consult any canonical-library or fabricate a match. (RFC §5 Stage 3, §8.11; **P4-T12**.)

#### Scenario: Rejected practice proposal yields a greenfield draft

- **WHEN** Stage 3 presents a practice proposal and the user rejects it
- **THEN** the dialog advances to Stage 4 with an empty practice-scaffold
- **AND** no canonical-library lookup is performed
- **AND** Stage 4's draft is grounded in the Stage 1 framing alone

### Requirement: Stage 4 proposes test-pyramid children for an implementation intent

When the drafted intent is an implementation intent (not itself a test-pyramid child), Stage 4 SHALL propose `…/unit-tests`, `…/integration-tests`, and `…/e2e-tests` children with canonical `covers-X` triples derived from the implementation's clauses; the user SHALL pick the subset to draft. (RFC §3.4, §5 Stage 4; **P4-T3**.)

#### Scenario: Pyramid children are proposed for an impl intent and only the picked subset is drafted

- **WHEN** a service-layer impl intent is being authored at Stage 4
- **THEN** Stage 4 proposes pyramid children `…/unit-tests`, `…/integration-tests`, `…/e2e-tests` with canonical `covers-X` triples
- **AND** the user picks {unit, integration}
- **AND** `intents_drafted[]` contains the impl intent + unit + integration test intents (only)

#### Scenario: A pure-leaf utility yields only the picked layer (no pyramid pretense)

- **WHEN** a pure utility intent is being authored and the user picks {unit} only
- **THEN** only the unit-tests child is drafted; no integration or e2e child appears

### Requirement: Stage 4.5 imports Phase-1 parser primitives — single source of truth

Stage 4.5 SHALL invoke the Phase-1 parser primitives directly (no reimplementation) — `validateMatrixPredicateNegation`, `validateAntecedentGrammar`, `validateRelatesToKinds`, `validateAtomicIntent` from `@dusk/core-parser`. A violation SHALL bounce the transition back to Stage 4 with the violation's `code` and a skill-name hint (`polarity-decision` / `implies-antecedent-grammar` / `typed-relates-to`); the Author drafts a corrected triple and re-enters 4.5. (RFC §3.1.1, §3.2.1; design D3.)

#### Scenario: A matrix-predicate negation in a triple's `predicate` slot bounces to Stage 4

- **WHEN** Stage 4 produces a drafted triple with a matrix-predicate-negation phrase in its `predicate` slot (e.g., `"does not use"`)
- **THEN** Stage 4.5 returns a bounce-to-Stage-4 outcome with hint `"polarity-decision"`
- **AND** the offending triple is preserved in `intents_drafted[]` so the Author can revise it
- **AND** the dialog does NOT advance to Stage 5

#### Scenario: A behavioral antecedent in a `compose: implies` intent bounces with the antecedent-grammar hint

- **WHEN** Stage 4 produces a `compose: implies` intent whose antecedent uses a behavioral predicate (e.g., `"performs a write"`) outside the closed vocabulary
- **THEN** Stage 4.5 bounces back to Stage 4 with hint `"implies-antecedent-grammar"`
- **AND** the dialog does NOT advance to Stage 5

#### Scenario: A `refines` kind in `relates_to` bounces with the typed-relates-to hint

- **WHEN** Stage 4 produces an intent declaring `relates_to: [{kind: "refines", target}]`
- **THEN** Stage 4.5 bounces back to Stage 4 with hint `"typed-relates-to"`

### Requirement: Stage 4 emits negative meaning as affirmative slots + `polarity: negative`

When the user's framing implies negative meaning, the Author SHALL draft triples with affirmative slot content and `polarity: negative` — never embedding English negation in the predicate slot. Stage 4.5 enforces this via the matrix-predicate primitive. (RFC §3.1; **P4-T4**.)

#### Scenario: "Must NOT use offset pagination" becomes affirmative + polarity:negative

- **WHEN** the user's request is "list endpoints must not use offset pagination"
- **THEN** Stage 4 produces a triple with affirmative slot content (e.g., `{subject: "list endpoints", predicate: "uses", object: "offset pagination"}`) and `polarity: "negative"`
- **AND** Stage 4.5 passes
- **AND** Stage 5 commits the intent

### Requirement: Stage 4 emits `compose: implies` with closed-vocabulary antecedents against resolvable references

When the user's request is conditional ("if X then Y must hold"), the Author SHALL draft a `compose: implies` intent whose antecedent uses the closed predicate vocabulary (`"is decorated with"`, `"claims any aspect of"`, `"is enclosed by a decoration of"`) against resolvable index references. (RFC §3.2.1, App. A.1; **P4-T5**.)

#### Scenario: A conditional intent commits with a closed-vocabulary antecedent

- **WHEN** the user's request is "if decorated `api/write-endpoint`, must validate idempotency"
- **THEN** Stage 4 produces a `compose: implies` intent with an `antecedent` group using `"is decorated with"` + a resolvable intent path and a `consequent` group with the idempotency clauses
- **AND** Stage 4.5 passes
- **AND** Stage 5 commits the intent

### Requirement: Stage 4 emits typed `relates_to` with five kinds and proposes reciprocal edges

When an authored intent relates to existing intents, Stage 4 SHALL emit `relates_to` edges using only the five typed kinds (`parent | implies | conflicts | supersedes | sibling`) — never `refines`. When the proposed edge has a meaningful reciprocal (e.g., `implies` → reciprocal `parent`-or-`sibling` on the target), the Author SHALL propose the reciprocal for user confirmation. (RFC §2.1, App. D.19; **P4-T6**.)

#### Scenario: An `implies` edge is emitted and the reciprocal is proposed

- **WHEN** Stage 4 drafts an intent that `implies` an existing intent
- **THEN** the drafted intent's `relates_to[]` contains `{kind: "implies", target: <existing-path>}`
- **AND** the Author proposes a reciprocal edge on the target for user confirmation
- **AND** no `refines` kind appears anywhere in the drafted set

### Requirement: Stage 5 finalize is atomic across all drafted intent files

Stage 5 finalize SHALL write every intent in `intents_drafted[]` via `@dusk/core-parser`'s atomic write (temp + rename). If any single write fails, ALL pending writes SHALL be rolled back (temp files deleted) and the dialog SHALL be preserved (not destroyed). The error envelope SHALL be `DuskError { kind: "author_finalize_partial_failure", details: { failed_intent_path, reason }, recoverable: true }`. (RFC §5 Stage 5; design D8; **P4-T7**.)

#### Scenario: Successful finalize writes every drafted intent atomically and resolves them

- **WHEN** a multi-intent dialog reaches Stage 5 finalize and every file write succeeds
- **THEN** each `intent.yaml` is written at `.ia/intents/<path>/intent.yaml`
- **AND** every file parses against the v2 schema
- **AND** `dusk_inspect` resolves the new intents and their pyramid children
- **AND** no code outside `.ia/intents/` is modified
- **AND** the dialog directory is removed

#### Scenario: Partial finalize failure rolls back all writes and preserves the dialog

- **WHEN** Stage 5 finalize is attempting to write three intents and the second write fails
- **THEN** no `intent.yaml` files are present at any of the three paths
- **AND** the dialog directory is preserved
- **AND** the response is `DuskError { kind: "author_finalize_partial_failure", recoverable: true }` naming the failing path

### Requirement: Author skills ship with concrete authoring guidance

The seven Author skills `dusk/author/{polarity-decision, typed-relates-to, implies-antecedent-grammar, tension-detection, discovery-grep-patterns, best-practices-application, test-pyramid-proposal}` SHALL each contain concrete authoring guidance — not stubs. `polarity-decision` shows affirmative-rewrite recipes for common negative phrasings; `implies-antecedent-grammar` enumerates the closed predicate vocabulary with worked examples; `best-practices-application` documents canonical decomposition patterns (cursor pagination, idempotency-on-writes, observability-on-cross-cutting-concerns) consumable as Stage 3 proposals. (RFC §5; design Q2.)

#### Scenario: Each skill file is loaded into the Author runtime spawn payload

- **WHEN** the Author runtime spawns its sub-agent for any stage
- **THEN** each of the seven skill files is present in `.claude/skills/dusk/author/`
- **AND** the runtime injects them into the Author's spawn payload (per Phase 2's `sub-agent-runtime` contract)
- **AND** none of the seven files is a placeholder shorter than ~30 lines of substantive guidance
