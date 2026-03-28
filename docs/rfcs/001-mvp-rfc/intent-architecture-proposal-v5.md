 # Intent Architecture: A Constraint System for Spec-Driven AI Development

**Status:** Working Proposal v5
**Date:** 2026-03-17
**Origin:** Iterative design synthesis, informed by the Blocks Architecture Design Competition (6 rounds, 6 architects, 58 artifacts)

---

## Part 1: The Problem

Software development is shifting to a model where engineers express intent in natural language and AI agents produce code. This works — until it doesn't. The agent generates plausible code that violates your pagination strategy, ignores your idempotency requirements, or implements soft delete in a way that breaks your event-sourced audit trail.

The gap isn't between natural language and code. It's between **intent and accountability**. Three specific failures cause this gap:

**Specs are subjective.** Two engineers write specs for the same feature and produce different documents with different structures, different levels of precision, different assumptions about what needs stating. The agent gets inconsistent input quality across tasks, teams, and projects. There's no shared grammar for architectural intent.

**Specs don't compose.** Your system has a pagination strategy, an error handling strategy, a soft delete policy, an idempotency requirement. These interact — soft delete and event sourcing conflict, idempotency keys need to correlate with saga correlation IDs. But each spec is a standalone document. Nobody writes the interaction rules, so the agent doesn't know about them, and silently generates code that violates cross-cutting concerns.

**Specs aren't verifiable.** After the agent writes the code, your spec sits in a file, inert. Nothing checks whether the code actually satisfies the constraints. You find violations during code review, or in production, or never. The spec has no authority because nothing enforces it.

These are three distinct problems. Solving one doesn't solve the others. Conflating them produces architectures that are complex without being complete.

---

## Part 2: Mental Model

### Constraint Satisfaction

These three problems map onto a well-known computational model: **constraint satisfaction**. A constraint satisfaction system has three parts:

A **constraint language** defines what must be true about a valid solution. A **solver** finds a solution satisfying the constraints. A **verifier** checks whether the solution actually satisfies them.

This is the structure of spec-driven AI development, stated precisely:

The **constraint language** is the spec format — how we express architectural intent with enough structure for machines to consume and verify. It has two tiers: canonical patterns (Blocks in the registry, community-authored) and project instantiations (Intents in the repo, composed from Blocks plus project-specific needs).

The **solver** is the AI agent — it receives constraints and produces an implementation that satisfies them. The solver is embedded in the agent's lifecycle via deterministic hooks, not invoked manually.

The **verifier** is the system-wide adherence monitor — multi-agent evaluation that checks the implementation against the full constraint set and maintains a persistent, incrementally-updated picture of how well the actual system conforms to the intended system.

### Why Not Transpilation?

A transpiler is a function — one input maps to one output. But "all list endpoints must use cursor-based pagination" doesn't map to one implementation. It maps to a **space** of valid implementations. The spec intentionally underspecifies, because over-specification is just writing the code twice at a higher level of abstraction.

The distinction changes where you invest. If it's transpilation, you optimize the compiler. If it's constraint satisfaction, you optimize three things independently: the expressiveness of the constraints, the effectiveness of the solver, and the coverage of the verifier.

### Why Not a Type System?

Types in programming languages are formally decidable — the compiler checks them with zero ambiguity in bounded time. But "saga orchestration must ensure eventual consistency across service boundaries" is not decidable in the formal sense. You can add obligation levels, scope, and cross-references — and you should — but you're adding *structure*, not *types* in the programming language sense.

Calling it a type system overpromises on determinism. The constraint satisfaction model sets honest expectations: violations are *detectable*, not *impossible*. A constraint system promises that invalid output gets flagged. That's a promise you can actually keep.

---

## Part 3: Data Model

The system has six data entities organized into three categories:

**Authored knowledge** — created by humans, version-controlled, hand-editable:
- **Blocks** — canonical patterns in the registry (community-authored)
- **Intents** — project-specific compositions in the repo (team-authored)

**Maintained state** — created by the system, version-controlled, reviewable in PRs:
- **Source Maps** — bidirectional links between constraints and implementation files
- **Composition Audits** — records of every AI decision made during constraint composition

**Accumulated state** — created by the system, ephemeral, rebuildable:
- **System Adherence State** — per-constraint verification verdicts

All entities share a common building block (**Constraints**) and a common relationship mechanism (**`relates_to`**). Together, Blocks, Intents, Source Maps, and Composition Audits form an **Intent Graph** — an emergent topology readable directly from the project's `.ia/` directory with no separate graph store.

### 3.1 Constraints

The constraint is the atomic unit of the entire system. Every Block and Intent is ultimately a container for constraints. A constraint is a single, falsifiable statement about the software.

```yaml
id: pag-001                          # Unique within parent
text: "All list endpoints must use    # Imperative, single sentence
  cursor-based pagination."
obligation: must                      # must | should | may
negative: false                       # true = prohibition
verifiability: mechanical             # mechanical | semantic
concern_hint: "pagination"            # Seeds clustering (optional)
refs:                                 # Inline references (optional)
  - target: api-idempotency/idem-003
    relationship: depends-on
    failure: "Retry after pagination cursor expiry
      requires idempotent re-fetch."
```

**Obligation as enforcement level.** `must` means a violation is a defect — the verifier treats it as a failure. `should` means a violation is a warning — the agent should follow it unless there's a good reason not to. `may` means an option — the verifier tracks adoption but doesn't flag non-use. Obligation also determines truncation order when context budgets are tight: drop `may` first, then `should`, never `must`.

**Verifiability class.** Constraints fall into two distinct difficulty classes for verification:

`mechanical` — verifiable by current LLMs at high accuracy because they reduce to pattern matching over code structure. "All list endpoints must use cursor-based pagination." "The event log must not be mutated after persistence." Expected accuracy: high (>85%).

`semantic` — requires the verifier to construct a mental model of system behavior from scattered file contents. "Saga orchestration must ensure eventual consistency across service boundaries." "Soft-delete cascades must preserve referential integrity across aggregate boundaries." Expected accuracy: lower and variable. Contested rates will be significantly higher.

This distinction does not change which verification mechanism is used (multi-agent evaluation for both). It changes how the results are **reported and trusted**. Adherence reporting must separate verdicts by class. A blended percentage that mixes reliable and unreliable verdicts is a vanity metric. The dashboard shows "Mechanical: 96%, Semantic: 62% (14 contested)" — not "91%."

Author-assigned on Blocks (the pattern author knows which constraints are structurally verifiable). AI-inferred default for project-specific constraints on Intents.

**Refs are annotations, not standalone artifacts.** A relationship between two constraints isn't a separate thing — it's knowledge *about* the declaring constraint. The `failure` field is what makes a reference actionable: the agent and developer learn the consequence, not just the relationship.

**Why single-sentence imperative text.** A constraint that takes a paragraph to express is probably multiple constraints, or it's implementation guidance rather than a verifiable assertion. Single sentences are scannable, composable, and individually addressable by the verifier.

### 3.2 Relationships (The Shared Mechanism)

Blocks and Intents both declare relationships to other Blocks and Intents using the same `relates_to` structure. This is the mechanism that forms the intent graph.

```yaml
relates_to:
  - target: canonical/soft-delete       # Block or Intent scope
    relationship: conflicts-with        # Relationship type
    rationale: "Immutable append-only   # Why this relationship exists
      event log is structurally
      incompatible with logical deletion."
    decision_required: true             # Needs team resolution (optional)
    decision_prompt: "Choose: ..."      # Guides the decision (optional)
    constraint_pairs:                   # Fine-grained specifics (optional)
      - source: es-003
        target: sd-001
        failure: "Replaying the event log will resurrect
          deleted entities in rebuilt projections."
```

**Relationship types and their behavior:**

| Relationship | Direction | Transitive? | What it tells the system |
|---|---|---|---|
| `depends-on` | Directed | Yes (cycle-detected, configurable depth) | Target must be pulled into scope when source is active. Changes to target may affect source. |
| `conflicts-with` | Bidirectional | No | These cannot coexist without an explicit resolution. Surface as a blocking tension during composition. |
| `tension-with` | Bidirectional | No | These create a tradeoff requiring a deliberate team decision. Surface as a significant tension during composition. |
| `complements` | Bidirectional | No | These work well together. Include in context for awareness but don't force inclusion. |
| `constrains` | Directed | No | Target's constraints are subordinate to source's constraints. Source adds requirements to target. |

**Why typed relationships, not generic "relates-to."** Each type produces distinct behavior. A dependency is transitive — follow it during scope resolution. A conflict is blocking — require a decision. A complement is informational. Collapsing these into one type loses information the system needs.

**Why `constraint_pairs` is optional.** You often know "these patterns interact" before you know exactly which constraints create the interaction. The relationship declaration is the starting point. Constraint pairs are precision that improves cross-references during composition. If not specified, AI discovers which constraints likely interact. If specified, those become high-confidence author-declared cross-references.

### 3.3 Blocks

A Block is a community-authored, registry-stored canonical pattern. It declares constraints for a single architectural concern — pagination, soft delete, event sourcing, idempotency — as objectively and universally as possible.

Blocks are **not authored at the project level**. They live in the Block Registry and enter through a rigorous vetting process. Engineers don't learn to write Blocks. They learn to *use* Blocks. Block authoring is a specialized community contribution.

**Schema:**

```yaml
# Identity
id: canonical/event-sourcing          # Namespaced identifier
version: 2.0.0                        # Semver
layer: data                           # infrastructure | data | api |
                                      # logic | interaction | presentation
summary: "Append-only immutable       # One sentence
  event log as source of truth."

# Relationships to other Blocks
relates_to:
  - target: canonical/soft-delete
    relationship: conflicts-with
    rationale: "Immutable append-only event log is structurally
      incompatible with logical deletion."
    decision_required: true
    decision_prompt: >
      Choose: (A) deletion as event type in the log, read model
      filters deleted entities; (B) tombstone events mark deletion
      boundaries; (C) no soft-delete for event-sourced entities.
    constraint_pairs:
      - source: es-003
        target: sd-001
        failure: "Replaying the event log will resurrect deleted
          entities in rebuilt projections."
  - target: canonical/api-idempotency
    relationship: depends-on
    rationale: "Event deduplication requires idempotent mutation
      endpoints to prevent duplicate events on retry."

# Constraints (at least one required)
constraints:
  - id: es-001
    text: "All state changes must be captured as immutable events."
    obligation: must
  - id: es-002
    text: "Events should include correlation IDs for distributed
      tracing."
    obligation: should
    concern_hint: "observability"
  - id: es-003
    text: "The event log must not be mutated after persistence."
    obligation: must
    negative: true

# Decision points (optional)
decision_points:
  - id: soft-delete-strategy
    description: "How to handle soft delete in an event-sourced system."
    options:
      - id: deletion-as-event-type
        description: "Model deletion as an event. Read model
          filters deleted entities."
      - id: tombstone-events
        description: "Tombstone events mark deletion boundaries
          in the stream."
      - id: no-soft-delete
        description: "Event-sourced entities cannot be soft-deleted."
    default: deletion-as-event-type
```

**Minimum viable Block — 6 fields, 3–5 minutes to author:**

```yaml
id: canonical/cursor-pagination
version: 1.0.0
layer: api
summary: "Cursor-based pagination for all list endpoints."
constraints:
  - id: pag-001
    text: "All list endpoints must use cursor-based pagination."
    obligation: must
  - id: pag-002
    text: "Page size must default to 25 with a maximum of 100."
    obligation: should
  - id: pag-003
    text: "Total count should not be provided for queries
      exceeding 10,000 rows."
    obligation: should
    negative: true
```

**Design rationale: the 6-field minimum.** The authoring barrier determines adoption. At 3–5 minutes, domain experts will transcribe existing ADRs, RFCs, and tribal knowledge into Blocks. Everything beyond id, version, layer, summary, and constraints is enrichment. The system handles absence gracefully.

### 3.4 Intents

An Intent is the project-level artifact that composes Blocks with project-specific requirements. It answers: "what does this project commit to at this scope?"

Intents live in the repo alongside the code they govern. They are version-controlled, diffable, reviewable in PRs, and human-readable. They are authored through an AI-assisted interface but are plain YAML that can be hand-edited.

**Schema:**

```yaml
# Identity and scope
id: intent-order-mgmt-checkout
scope: acme/order-management/checkout

# Block composition (the "stack")
adopts:
  - block: canonical/cursor-pagination@^1.0.0
  - block: canonical/soft-delete@^2.0.0
  - block: canonical/event-sourcing@^2.0.0

# Decisions for adopted Block decision points
decisions:
  - block: canonical/event-sourcing
    decision_point: soft-delete-strategy
    chosen_option: deletion-as-event-type
    rationale: >
      We implement soft-delete as a 'deleted' event type in the
      event log. The read model filters deleted entities.
      Preserves event immutability.
    constraints_produced:
      - id: es-sd-resolution-001
        text: "Soft-delete must be implemented as a 'deleted'
          event type, not as a record mutation."
        obligation: must

# Relationships to other Intents
relates_to:
  - target: acme/billing
    relationship: depends-on
    rationale: "Checkout totals depend on billing's tax
      calculation and pricing constraints."
    constraint_pairs:
      - source: checkout-001
        target: billing/tax-002
        failure: "Incorrect totals if tax rules change
          without checkout awareness."
  - target: acme/identity
    relationship: constrains
    rationale: "All checkout flows must enforce identity's
      authentication and session constraints."

# Project-specific constraints
constraints:
  - id: checkout-001
    text: "Checkout page size must default to 10."
    obligation: must
  - id: checkout-002
    text: "Checkout must validate inventory availability
      before payment processing."
    obligation: must
    refs:
      - target: acme/inventory/inv-003
        relationship: depends-on
        failure: "Overselling if inventory check is skipped
          or stale."
```

Source maps and composition audits are **not** part of the intent file. They are co-located in the same directory (see 3.8) but are separate artifacts with distinct lifecycles. The intent file stays clean — only authored knowledge that engineers read and edit.

### 3.5 Source Maps

A Source Map is the bidirectional link between an intent's constraints and the implementation files that realize them. It's the bridge between constraint space and code space — without it, the verifier must search the entire codebase for every constraint, and the agent has no guidance on which files are relevant.

Source maps are built and maintained through a **multi-mechanism pipeline** ordered by reliability. The highest-priority mechanisms are near-deterministic; lower-priority mechanisms fill gaps where deterministic signals don't exist. Engineers can contribute to mapping accuracy through lightweight code annotations, but the system doesn't require them.

**Schema:**

```json
{
  "intent": "todo--api",
  "intent_hash": "sha256:a4f8c2e9...",
  "synced_at": "2026-03-16T14:23:00Z",
  "stale": false,
  "mappings": [
    {
      "constraint": "pag-001",
      "files": [
        {
          "path": "api/src/middleware/pagination.ts",
          "confidence": 1.0,
          "provenance": "annotation",
          "last_confirmed": "2026-03-16T14:20:00Z"
        },
        {
          "path": "api/src/controllers/todos.controller.ts",
          "confidence": 0.88,
          "provenance": "llm-classified",
          "last_confirmed": "2026-03-16T14:23:00Z"
        }
      ]
    },
    {
      "constraint": "idem-001",
      "files": [
        {
          "path": "api/src/middleware/idempotency.ts",
          "confidence": 0.92,
          "provenance": "dependency-analysis",
          "last_confirmed": "2026-03-16T14:22:00Z"
        }
      ]
    }
  ],
  "unmapped": [
    "api/src/utils/logger.ts",
    "api/src/utils/env.ts"
  ]
}
```

**Mapping pipeline — ordered by reliability:**

1. **Explicit annotations** (deterministic). A lightweight marker in source code: `// @intent pag-001`. Parsed programmatically. Near-zero developer cost, near-zero ambiguity. This is the highest-priority signal — when present, it overrides all other mechanisms for that constraint-file pair. Engineers are never required to write annotations, but the system rewards them with higher mapping confidence.

2. **LLM-based structured classification** (high capability). Given a file and a set of candidate constraints from the active intents, a model produces constraint IDs with confidence scores via structured output. This is fundamentally more capable than embedding distance because the model can reason about semantic relationships between code behavior and constraint intent. This is the primary AI mechanism — it replaces raw vector similarity for constraint-to-file mapping.

3. **Dependency/import graph analysis** (deterministic). What does this file import? What calls it? Structural connectivity suggests constraint relevance. If `pagination.ts` is imported by `todos.controller.ts`, and the pagination middleware is mapped to `pag-001`, the controller likely relates to pagination too.

4. **File path convention matching** (deterministic). `src/middleware/pagination.ts` likely relates to pagination constraints. Simple heuristic, covers obvious cases.

5. **Vector similarity** (supplemental). Embedding distance between code content and constraint text. Fills remaining gaps cheaply. Lowest priority because natural language constraints and source code occupy different regions of embedding space — similarity scores are noisy.

**`provenance` on each file mapping.** Every mapping records how it was established: `annotation`, `llm-classified`, `dependency-analysis`, `path-convention`, or `embedding-similarity`. Provenance determines how much the verifier trusts the mapping and helps identify where accuracy improvements are most needed. Annotation-sourced mappings are treated as near-deterministic. Embedding-sourced mappings are treated as candidates that benefit from confirmation.

**`intent_hash` and consistency.** The source map stores the SHA-256 hash of the intent file it was last synced against. On any read — hook startup, verification, CLI command — the system compares this hash to the current intent file. If they differ, the intent has changed since the source map was last updated, and the map is flagged as stale. Stale source maps are not trusted for verification scoping; the verifier falls back to broader search. No background daemon required — staleness is detected on read.

**`confidence` on each file mapping.** Not every mapping is equally certain. Annotation-sourced mappings are 1.0 by definition. LLM-classified mappings reflect the model's self-assessed confidence. The PostToolUse hook adjusts confidence over time: files repeatedly confirmed in the context of a constraint gain confidence; files that stop being relevant decay.

**`unmapped` list.** Files the pipeline evaluated but couldn't confidently link to any constraint in this intent. Visible as a coverage gap, not silent.

**Why JSON, not YAML.** Source maps are machine-maintained, not human-authored. JSON is faster to parse and write, which matters for PostToolUse hook performance.

**Why one source map per intent.** The intent is the natural partition. The PostToolUse hook only loads source maps for intents in scope. When an intent is deleted, its source map is deleted (same directory). The coupling is structural.

**Reverse index.** For fast "which constraints relate to this file?" lookups, the system builds a reverse index in memory at session start from all loaded source maps. Cached in `.ia/cache/reverse-index.json` between sessions. Always rebuildable from source maps.

### 3.6 Composition Audit

A Composition Audit records every AI decision made when composing an intent's constraints into agent-consumable output. It's the transparency mechanism that makes AI-assisted composition trustworthy.

During composition, AI makes several judgment calls: grouping constraints into concerns, detecting duplicate constraints across blocks, discovering cross-references between constraints that weren't explicitly declared, generating preamble text for facets, and ranking constraints by relevance to a task. Each of these decisions could be wrong. The audit log makes them visible and overridable.

**Schema:**

```json
{
  "intent": "todo--api",
  "composed_at": "2026-03-16T14:30:00Z",
  "composition_version": "cv-a1b2c3",
  "decisions": [
    {
      "type": "concern_assignment",
      "constraint": "pag-001",
      "assigned_concern": "pagination",
      "source": "concern_hint",
      "confidence": 1.0
    },
    {
      "type": "concern_assignment",
      "constraint": "idem-001",
      "assigned_concern": "api-contracts",
      "source": "ai-clustered",
      "confidence": 0.82,
      "rationale": "Grouped with pagination and rate-limiting
        based on API-layer semantic similarity."
    },
    {
      "type": "dedup_merge",
      "kept": "pag-001",
      "merged": "custom-pag-010",
      "source": "ai-detected",
      "confidence": 0.91,
      "rationale": "Both express cursor-based pagination
        requirement. Kept block version (higher obligation)."
    },
    {
      "type": "stitch_discovered",
      "source_constraint": "sd-001",
      "target_constraint": "es-003",
      "relationship": "conflicts-with",
      "source": "ai-discovered",
      "confidence": 0.87,
      "rationale": "Logical deletion conflicts with immutable
        event streams."
    },
    {
      "type": "obligation_inferred",
      "constraint": "custom-012",
      "inferred_obligation": "should",
      "confidence": 0.72,
      "rationale": "Phrasing suggests recommendation, not
        requirement. Flagged for review."
    }
  ]
}
```

**Decision types:**

Composition decisions fall into two categories with different risk profiles:

**Destructive decisions** — these change the active constraint set or enforcement semantics. A mistake silently removes or weakens a constraint.

| Type | What happened | Risk |
|---|---|---|
| `dedup_merge` | Two constraints identified as duplicates, one removed | Silent constraint loss |
| `obligation_inferred` | A missing obligation level was inferred from text | Enforcement semantics changed |

**Additive decisions** — these organize or annotate constraints. A mistake is recoverable and doesn't lose information.

| Type | What happened | Risk |
|---|---|---|
| `concern_assignment` | A constraint was assigned to a concern (facet) | Wrong grouping, recoverable |
| `stitch_discovered` | A cross-reference between constraints found by AI | Wrong cross-reference, ignorable |
| `preamble_generated` | A facet's introductory text was generated | Misleading summary, fixable |
| `relevance_ranked` | Constraints ranked by relevance to a task | Wrong priority, non-destructive |

**Every decision carries a `source` and `confidence`.** `source` is one of: `concern_hint` (author-provided tag), `ai-clustered`, `ai-detected`, `ai-discovered`, `ai-inferred`. `confidence` is the AI model's self-assessed certainty.

**Additive decisions** below a standard threshold (default: 0.7) are flagged for human review. Wrong grouping is cheap to fix.

**Destructive decisions** are held to a higher standard. Below a high confidence threshold (default: 0.9), destructive decisions are flagged as `pending_confirmation` rather than auto-applied. They appear in the composition output as candidates requiring developer confirmation before taking effect. A false-positive dedup that silently removes a constraint from enforcement is qualitatively worse than a wrong concern assignment — the system must treat them differently. The threshold is configurable in `ia.config.yml` and should be calibrated via the composition black-box test suite.

**Why version-controlled.** Engineers need to see what AI decided and override it when it's wrong. These are reviewable in PRs: "the composition flagged constraints X and Y as duplicates — I disagree, they cover different cases." The audit log is what makes the composition pipeline transparent rather than a black box.

**Why per-intent.** Each intent composes independently. Its audit log records its own composition decisions. Co-located in the intent directory alongside `intent.yaml` and `source-map.json`.

### 3.7 How Relationships Flow: Block → Intent

When an Intent adopts two Blocks that have a declared relationship, that relationship **inherits into the Intent automatically**. The engineer doesn't redeclare it.

```
Intent adopts: event-sourcing, soft-delete
Registry knows: event-sourcing conflicts-with soft-delete

→ Intent inherits the conflict
→ Composition surfaces it as a tension
→ Engineer must resolve it (via a decision on the intent)
→ Resolution is recorded, resolution constraints are added
```

At the Intent level, the system sees three kinds of relationships:

**Inherited from Blocks** — carried automatically when adopted Blocks have relationships. The engineer doesn't write these. They appear because the registry knows about them.

**Declared on Intents** — written by the team for project-specific architecture. "Checkout depends on billing." These don't come from any Block.

**AI-discovered** — found during composition when the system detects likely interactions that neither Blocks nor Intents explicitly declare. Labeled as `ai-discovered` with a confidence score so engineers can validate or dismiss them.

All three use the same `relates_to` structure. The `source` field distinguishes them:

```yaml
resolved_relationships:
  - target: canonical/soft-delete
    relationship: conflicts-with
    source: inherited-from-block
    resolved: true
    decision: deletion-as-event-type

  - target: acme/billing
    relationship: depends-on
    source: intent-declared

  - target: acme/audit
    relationship: complements
    source: ai-discovered
    confidence: 0.78
```

### 3.8 The Intent Directory

Each intent lives in its own directory under `.ia/intents/`. The directory is the **atomic unit** — it contains the intent's authored knowledge, its AI-maintained source map, and its composition audit log. Delete the directory and everything about that intent is gone. No orphans, no cross-directory name matching.

```
ia.config.yml                          # Project-level tool configuration

.ia/
  intents/                             # All intent directories
    acme--order-management/
      intent.yaml                      # Authored (version-controlled)
      source-map.json                  # AI-maintained (version-controlled)
      audit.json                       # Composition decisions (version-controlled)
    acme--billing/
      intent.yaml
      source-map.json
      audit.json
    acme--identity/
      intent.yaml
      source-map.json
      audit.json
  cache/                               # Gitignored: derived runtime data
    reverse-index.json                 # file → constraints (from source maps)
    embeddings.db                      # Vector store for constraint text
    composition/                       # Cached manifests/facets
  adherence/                           # Gitignored: system-wide verdict state
    state.db
```

**What's version-controlled:** Everything under `.ia/intents/`. Intent files (authored knowledge), source maps (AI-maintained but reviewable), and audit logs (composition transparency). These are shared knowledge the team reviews in PRs.

**What's gitignored:** `.ia/cache/` (derived, always rebuildable from source maps and blocks) and `.ia/adherence/` (rebuilt from full audits, or treated as ephemeral per-environment state).

**`ia.config.yml`** at the project root configures the tool:

```yaml
version: 1
blocks:
  source: ./blocks/canonical         # Path or registry URL
intents:
  dir: .ia/intents                   # Where intent directories live
scope_root: acme                     # Namespace prefix
hooks:
  tool: claude-code                  # Agent tool to generate hooks for
  source_map:
    confidence_threshold: 0.6        # Below this, flag as unmapped
verification:
  agents: 3                          # Evaluation agents
  triage: true                       # Enable pre-filter
```

### 3.9 Scope and Inheritance

Scopes are slash-delimited hierarchical strings that express where an intent applies:

```
acme/order-management          ← domain
acme/order-management/checkout ← feature within that domain
acme/billing                   ← another domain
acme/identity                  ← another domain
```

When scope hierarchy exists, a constraint at a broader scope applies to all descendants. However, when a narrower scope declares a constraint that contradicts, weakens, or overrides a broader scope's constraint, **this is not resolved silently**. The system surfaces it as a blocking tension requiring explicit resolution with rationale — the same mechanism used for Block-level `conflicts-with` relationships.

Silent override is antithetical to the system's purpose. If a narrower scope quietly weakens a `must`-level constraint from a broader scope, the system has hidden exactly the kind of decision it exists to surface. Any time the system detects that one constraint would override, contradict, or weaken another across scope boundaries, it presents the conflict, explains the implications, and requires a recorded decision. The developer resolves it with rationale. The system records the resolution. This applies to: same-scope contradictions, narrower scope weakening a broader `must`, and obligation-level conflicts across scopes.

Scope hierarchy is not mandatory. Intents can be peers at the same level, connected by `relates_to` edges rather than by parent-child nesting. In practice, most projects are structured this way — a set of peer intents (api, data, ui, auth, or domain-level scopes) connected by typed relationships rather than arranged in a tree.

### 3.10 The Intent Graph

The intent graph is not a separate data structure. It is the **emergent topology** of all Intents and their declared relationships, readable directly from the `.ia/intents/` directory.

**Intent graphs do not require a root node.** Every "system-level" concern that appears to need a global parent is, on inspection, decomposable into its own scoped intent. "This system uses REST with JSON" is an API contract intent. "We never physically delete data" is a data lifecycle intent. "Authenticate at the boundary" is an auth intent. There is no irreducible global constraint that can't be expressed as its own intent connected to others via `relates_to`.

The "system" isn't a parent node — it's the emergent collection of all intents and their relationships. The graph is a connected mesh of peers, not a tree with a root. The system allows scope hierarchy when it exists naturally, but doesn't mandate it.

A mandatory root intent becomes one of two things: a dumping ground for cross-cutting constraints that actually belong in specific intents, or an "architectural thesis" too abstract to be falsifiable. Either way, it adds ceremony without adding verifiable knowledge. The system's identity is expressed through the collection of intents and their relationships, not through a single parent document.

**What forms the graph:**

The **cross-scope edges** are the `relates_to` declarations on Intents — architectural relationships between areas of the system. These are the primary structure.

The **inherited pattern interactions** are `relates_to` declarations from adopted Blocks, carried into the Intents that adopt them.

The **constraint-level cross-references** are the `refs` on individual constraints — fine-grained implementation-level interactions.

The **scope hierarchy**, when present, is derived from scope strings. Optional structure, not mandatory.

The **source maps** link the graph to the codebase — each intent's `source-map.json` connects its constraints to implementation files.

Read all the intent directories plus their adopted Blocks, and you have the complete graph. No separate graph store required.

**Adherence rollup without a root.** System-wide adherence aggregates across all intents: each intent's constraints produce verdicts, verdicts roll up per-concern within each intent, and the collection of all intent-level adherence produces the system-wide picture. The graph's `relates_to` edges determine which intents are affected when something changes.

### 3.11 System Adherence State

The System Adherence State is the persistent, incrementally-updated collection of per-constraint verdicts. It's the ground truth for how well the actual system conforms to the intended system. Stored in `.ia/adherence/state.db` (SQLite), gitignored, rebuilt from full audits.

**Verdict record:**

```yaml
constraint: acme/order-management/soft-delete/sd-001
intent: acme--order-management
obligation: must
last_evaluated: 2026-03-15T14:23:00Z
evaluated_against: commit abc123
verdict: fail
evidence:
  files:
    - path: src/orders/services/deletion.ts
      lines: 45-52
      finding: "Physical DELETE executed without recovery
        window check."
  agent_agreement: 3/3
  reasoning_summary: "All agents identified direct SQL
    DELETE on line 47..."
```

One record per constraint. Updated when something triggers re-evaluation. The collection of all records, projected through the intent graph, produces every view the system needs: per-constraint findings, concern-level adherence, scope-level adherence, system-wide health.

**Verdicts are enumerated, not numeric:**

| Verdict | Meaning |
|---|---|
| **pass** | Agents agree the code satisfies the constraint |
| **partial** | Code satisfies the constraint in some paths but not all |
| **fail** | Agents agree the code violates the constraint |
| **contested** | Agents disagree after discourse. Human review needed. |
| **not-applicable** | The constraint doesn't apply to the changed code |

---

## Part 4: System Components

### 4.1 Block Registry

The Block Registry is a community-curated, semantically searchable collection of canonical Blocks. It is closer to a standard library than a package manager — there's a quality gate, not just a publish button.

**Vetting criteria.** Blocks enter through a change request process. Constraints must be falsifiable where possible, objective rather than subjective, and independent of specific frameworks or languages.

**Known interactions.** When two Blocks are commonly adopted together, the community accumulates knowledge about their interactions via `relates_to` declarations.

**Semantic search.** Block summaries and constraint text are embedded for vector search. "I'm building an event-sourced system with a REST API" surfaces pagination, idempotency, event schema versioning, and saga patterns along with their known interactions.

### 4.2 Context Resolver

The Context Resolver delivers the right constraints to the AI agent for a given task. It's a query engine — fast, cacheable, incremental.

**Resolution steps** given a scope and a task description:

1. **Scope matching** — find all Intents that apply at this scope (prefix matching up the hierarchy). Deterministic.
2. **Block expansion** — for each adopted Block, pull in constraints. For `depends-on` relationships, follow transitively with cycle detection and configurable depth limit (default: 10). When the depth limit truncates, the manifest notes how many additional constraints were excluded. Deterministic.
3. **Decision application** — apply tension resolutions and decision outcomes. Replace open decision points with resolved constraints. Deterministic.
4. **Deduplication** — detect same-intent-different-phrasing across Blocks. AI-assisted. Logged to audit.
5. **Concern clustering** — group constraints by cross-cutting topic. Seed from `concern_hint` tags, AI clusters the rest. Logged to audit.
6. **Relevance ranking** — rank concerns by relevance to the task description using embedding similarity. AI-assisted.
7. **Presentation** — assemble the two-level output.

Cache the result. Invalidate when any input changes. Every AI-made decision logged to the intent's `audit.json`.

**Progressive presentation: Manifest and Facets.**

The **Manifest** is always delivered first. Under 600 tokens. Contains all concerns in scope, constraint counts and obligation distributions, active tensions and conflicts (blocking first), and retrieval addresses for each Facet.

**Facets** are retrieved on demand. One per concern. 300–1,000 tokens each. Contains a preamble (2–3 sentences), constraints ordered by obligation (`must` first), inline cross-references (stitches) with failure descriptions, resolved decision points, related Facets, and source map entries for the relevant code.

**Stitches** are inline cross-references on constraints within Facets. They come from three sources: constraint-level `refs`, `constraint_pairs` from `relates_to` declarations, and AI-discovered interactions. Each carries a relationship type, rationale, failure description, and source label.

**Density valve:** A cap (default: 2) on inline failure hints per constraint. Overflow is queryable on demand.

**MCP tools:**

| Tool | Input | Output | When Used |
|---|---|---|---|
| `get_intent_manifest` | scope | Manifest (<600 tok) | Session start |
| `get_facet` | scope, facet_slug | Full Facet (300–1,000 tok) | Agent needs concern details |
| `query_constraints` | scope, natural language query | Matched constraints + traversed results | Targeted search |
| `get_composition_audit` | scope, filters | Audit entries | Developer reviews AI decisions |

These same tools are available to verification agents during evaluation.

### 4.3 Verification System

The Verification System is a **system health monitor**, not a code review tool. It maintains a persistent, incrementally-updated picture of how well the actual system conforms to the intended system.

#### Two Triggers

**Trigger 1: Code changed.** Re-evaluate affected constraints, update the system-wide picture.

**Trigger 2: Intents changed.** The intended state moved. Evaluate the current codebase against new/changed constraints. The gap between current adherence and the new intended state is the implementation roadmap.

Both triggers produce the same output: updated verdict records in the adherence state.

#### Evaluation Mechanism

Verification uses **multi-agent evaluation with structured discourse**.

**Step 1 — Triage.** A single fast agent reads the diff and potentially-affected constraints (from the source map) and answers: "does this change materially affect any of these constraints?" Per-constraint yes/no.

**Step 2 — Context assembly.** For each flagged constraint: the constraint text, obligation level, and cross-references; the relevant code files (from the source map); the previous verdict (if any). Evaluation agents have access to the same progressive MCP tools as implementation agents — they can drill into manifests, facets, and queries for additional context.

**Step 3 — Independent assessment.** Three agents independently evaluate the constraint. Each produces: verdict, confidence, evidence (file/line), reasoning referencing the constraint text. Verification agents should not all be the same model — shared model blindspots produce false consensus. At minimum, two distinct models in the verification pool. Cost-tiering applies: mechanical constraints can be evaluated with faster/cheaper models; semantic constraints benefit from more capable models.

**Step 4 — Discourse.** If all agree, skip to synthesis. If they disagree, the orchestrator facilitates targeted resolution: identify the disagreement, ask the dissenter to explain, give others a chance to respond. Structured, not open-ended.

**Step 5 — Synthesis.** Final verdict (pass/partial/fail/contested/not-applicable) with: constraint address, evidence, reasoning chain, agent agreement level.

#### Orchestrator Rollup

Constraint verdicts → concern-level adherence → scope-level adherence → system-level adherence. Weighted by obligation.

```
SYSTEM ADHERENCE — acme — 2026-03-15

Mechanical: 96% (198/206 constraints pass)
Semantic:   72% (78/108 constraints pass, 22 contested)

├── acme/order-management
│   Mechanical: 94%  Semantic: 68% (2 contested)
│   ├── soft-delete: 3/5 pass, 1 partial, 1 fail
│   ├── cursor-pagination: 5/5 pass
│   ├── event-sourcing: 5/6 pass (mechanical), 2/2 contested (semantic)
│   └── saga-orchestration: 2/3 pass, 1 contested (semantic)
│
├── acme/billing
│   Mechanical: 100%  Semantic: 80%
│
├── acme/identity
│   Mechanical: 100%  Semantic: 100%
│
└── acme/notifications  ← new intents, gap = roadmap
    Mechanical: 82%  Semantic: 44% (6 contested)
    ├── event-sourcing: 4/6 pass, 2 fail
    ├── retry-strategy: 0/4 pass
    └── idempotency: 3/3 pass
```

Adherence reporting always separates mechanical and semantic verdicts. A blended percentage that mixes reliable and unreliable verdicts obscures the signal. The team sees exactly which numbers they can trust and where the system is less certain.

#### Verification Report

```
VERIFICATION — acme/order-management — PR #847

14 constraints evaluated across 6 files
11 pass · 1 partial · 1 fail · 1 contested

FAIL  [must] soft-delete/sd-001
  "All entity deletions must be logical."
  → src/orders/services/deletion.ts:47
  Finding: Physical DELETE without recovery window check.
  Agreement: 3/3 agents
  Related: event-sourcing/es-003, audit-trail/at-002

PARTIAL  [should] soft-delete/sd-004
  "Soft delete should cascade to dependent entities."
  → src/orders/services/deletion.ts:52
  Finding: Cascades to line items but not shipments.
  Agreement: 2/3 agents

CONTESTED  [should] saga-orchestration/so-005
  "Cross-service state changes should use saga coordination."
  → src/orders/services/deletion.ts:67
  Agent A: fail — no compensating transaction
  Agent B: pass — event-driven sufficient here
  Agent C: partial — correct pattern, missing rollback
  → Recommend human review

PASS  [must] cursor-pagination/pag-001 (and 10 others)
```

#### Drift Detection

Drift is not a separate system. It's verification compared over time. A constraint that was pass and is now fail drifted. Correlate verdict changes with commit history for "when did this start failing?"

#### Bounded Evaluation Protocol

When an agent iterates on implementation, the evaluation loop has convergence guarantees:

**Round 1: Full evaluation.** Complete finding set produced. Finding set **locked** — this is the only round where new findings are accepted.

**Round 2+: Scoped re-evaluation only.** Only fail/partial/contested constraints re-evaluated. Each gets: **resolved** (now passes), **persists** (fix insufficient), or **regressed** (fix made it worse). New observations become **deferred findings** — logged, queued for next cycle, not blocking.

**Convergence guarantee:** the finding set can only shrink. Terminates when all must-level resolved or developer accepts remaining with rationale.

**Design rationale.** Mirrors high-performing engineering teams: fixed rubric, bounded rounds, scoped re-review. The reviewer doesn't use round two to find new things.

#### Full System Audit

Periodically (nightly, weekly, on-demand), complete evaluation of all constraints against entire codebase. Catches code changes outside the hook system, cumulative drift, and source map staleness. Expensive but ground truth.

#### Cost Awareness

Multi-agent verification is expensive. Running three agents per flagged constraint per code change scales with constraint count and triage pass-through rate. A medium system with 300 constraints where triage flags 20 per PR requires 60+ LLM calls. Full system audits at scale (1,000+ constraints) cost substantially more.

Cost-tiering by verifiability class is essential for sustainability. Mechanical constraints — which reduce to pattern matching — can be evaluated with faster, cheaper models. Semantic constraints — which require architectural reasoning — benefit from more capable (and more expensive) models. The system should route constraints to appropriate model tiers based on their verifiability class.

Cost instrumentation should be built into the verification system from its first increment: triage pass-through rates, per-constraint evaluation cost, total per-PR cost, and full audit cost. These metrics determine the viable default verification configuration and inform whether verification runs on every stop hook, on PR creation, or on a scheduled cadence.

### 4.4 Lifecycle Hooks

The constraint system is embedded in the AI agent's execution lifecycle through deterministic hooks — guaranteed to execute at specific points.

**Three hooks, three distinct concerns:**

```
Pre:  inject resolved constraints
Post: link code to intent graph
Stop: trigger verification cycle
```

**Pre-Execution (SessionStart / PreToolUse):**
1. Load all intent directories, check source map content hashes for staleness
2. Build in-memory reverse index (file → constraints) from source maps
3. Resolve relevant intents for current scope, compose manifest, inject into agent context

**Post-Execution (PostToolUse):**

Every time the agent writes or edits a file, one question: **which intents and constraints does this code relate to?** Same pipeline whether the file is new, modified, or moved:

1. Reverse index lookup — O(1) for known files (in memory)
2. If unknown or needing reclassification, the mapping pipeline runs in priority order: check for explicit `// @intent` annotations (deterministic), run LLM-based structured classification against candidate constraints (primary AI mechanism), analyze dependency/import graph (deterministic supplement), match file path conventions, fall back to vector similarity for remaining gaps
3. Update in-memory source map + reverse index, mark dirty, record provenance per mapping
4. Low confidence → "unmapped" flag

Updates are in-memory during the session. No disk I/O on every edit.

**Stop (Stop):**
1. Flush dirty source maps to `.ia/intents/*/source-map.json`, update `intent_hash`
2. Persist reverse index to `.ia/cache/`
3. Run verification triage → multi-agent evaluation → adherence update → conformance report

### 4.5 AI-Assisted Authoring Interface

Intents are composed through an AI-native interface — a conversational workflow for planning and committing.

**Composition:** Search the registry for relevant patterns, surface interactions and tensions, prompt for decisions, identify project-specific requirements, suggest relationships to existing intents, determine granularity.

**Granularity discovery:** The engineer may start intending one intent. The system may identify that certain concerns deserve their own scope.

**Delta-driven implementation:** New intents immediately show the gap between intended and actual state. The interface facilitates task breakdown from the delta.

**Human-readable output:** Intent files are plain YAML. The AI interface is the power tool, not the gatekeeper. Engineers can read, edit, diff, and review without it.

---

## Part 5: Flows

### 5.1 Authoring Flow

```
Engineer describes what they're building
  │
  ▼
AI interface searches Block Registry
  │ → surfaces relevant patterns with known interactions
  │ → surfaces conflicts/tensions requiring decisions
  │
  ▼
Engineer selects Blocks, resolves tensions with rationale
  │
  ▼
Engineer adds project-specific constraints and relates_to edges
  │
  ▼
System determines intent granularity
  │ → one intent or multiple connected peers
  │
  ▼
Intent directory/directories created under .ia/intents/
  │ intent.yaml written, source-map.json + audit.json scaffolded
  │
  ▼
Verification evaluates codebase against new intents
  │ → "Current adherence: 52%. 14 constraints unsatisfied."
  │ → Gap = implementation roadmap
```

### 5.2 Implementation Flow

```
Agent receives task
  │
  ▼
Pre hook: load intent directories, check source map hashes,
  build reverse index, compose manifest, inject into context
  │ Agent sees: concerns, tensions, constraint counts
  │
  ▼
Agent requests relevant Facet via MCP
  │ Reads constraints with inline stitches
  │ Knows cross-layer interactions without additional calls
  │
  ▼
Agent implements
  │ For each file created or modified:
  │   Post hook: link code to intent graph
  │   (annotations → LLM classification → deps → path → vector)
  │   (provenance tracked per mapping, in-memory, no disk I/O per edit)
  │
  ▼
Agent finishes
  │
  ▼
Stop hook:
  │ Flush dirty source maps (update intent_hash)
  │ Triage → multi-agent evaluation (model diversity) → adherence update
  │ Conformance report (separated by verifiability class)
  │
  ▼
Engineer reviews report
  │ Addresses failures → scoped re-evaluation (bounded protocol)
  │ Finding set can only shrink
  │
  ▼
System adherence updates
```

### 5.3 Verification Flow

```
Trigger: code change OR intent change
  │
  ▼
Source maps consulted (via reverse index for code changes,
  or direct for new/modified intents)
  │
  ▼
Triage: fast agent reads diff + constraint set
  │ Per-constraint: does this change materially affect this?
  │
  ▼
For each flagged constraint:
  │
  ├── Context assembly (constraint + code + previous verdict)
  │   Agents can progressively explore via MCP tools
  │
  ├── Independent assessment (3 agents, min 2 distinct models)
  │   Cost-tiered: mechanical constraints → faster/cheaper models
  │                 semantic constraints → more capable models
  │   Verdict, confidence, evidence, reasoning
  │
  ├── Discourse (if disagreement)
  │   Targeted, structured, not open-ended
  │
  └── Synthesis → verdict record (tagged with verifiability class)
  │
  ▼
Verdict records updated in .ia/adherence/state.db
  │
  ▼
Rollup: constraint → concern → scope → system
  │ Separated by verifiability class at every level
  │
  ▼
Two views:
  Verification report (diff): "Mechanical: 96%, Semantic: 62%"
  Dashboard (state): system-wide, per-scope, per-concern
```

### 5.4 Source Map Maintenance Flow

```
Session start (pre hook):
  │
  ├── Load .ia/intents/*/ directories
  │   Read intent.yaml + source-map.json per directory
  │   Compare intent_hash → flag stale source maps
  │
  └── Build reverse index in memory
      file → [(intent, constraint, confidence, provenance)]

PostToolUse fires on file change:
  │
  ├── Reverse index lookup (O(1) in memory)
  │   Known file → confirm/adjust existing mapping
  │
  ├── Unknown file → mapping pipeline (priority order):
  │   1. Check for // @intent annotations (deterministic)
  │   2. LLM-based structured classification
  │      (file + candidate constraints → constraint IDs + confidence)
  │   3. Dependency/import graph analysis (deterministic)
  │   4. File path convention matching (deterministic)
  │   5. Vector similarity against constraint embeddings (gap-fill)
  │
  ├── Update in-memory maps + reverse index
  │   Record provenance per mapping
  │   Mark affected source maps as dirty
  │
  └── Low confidence → "unmapped" list

Session end (stop hook):
  │
  ├── Flush dirty source-map.json files
  │   Update intent_hash to current intent file hash
  │
  └── Persist reverse index to .ia/cache/

Backstop: verifier catches stale mappings
  Previously-passing constraint fails at mapped location
  → re-mapping pass for that intent
```

---

## Part 6: Design Decisions and Rationale

### Why Blocks are registry-only

If anyone can author Blocks at the project level, quality varies wildly. Blocks as curated community knowledge with a vetting process means the registry is a standard library. Engineers learn to use Blocks, not write them. Block authoring is a specialized community contribution.

### Why one `relates_to` mechanism for both Blocks and Intents

Block-to-block relationships are universal pattern knowledge. Intent-to-intent relationships are project-specific architecture. Same shape, same structure. One mechanism to learn, one to traverse, clean inheritance when block relationships flow into intents.

### Why relationships live on the declaring entity

Making relationships standalone artifacts (separate Edge objects) creates a synchronization problem: the edge can disagree with the entities it connects. Relationships as properties of Blocks and Intents are always consistent with their context.

### Why the intent graph is emergent, not built

Every relationship lives on the entity that declares it. There is no separate graph database, no edge table, no synchronization problem. The graph is always consistent with the source files because it *is* the source files, read together.

### Why intent graphs don't have roots

Every "system-level" concern is decomposable into its own scoped intent. A mandatory root becomes either a dumping ground for misplaced constraints or an unfalsifiable thesis. The system's identity is expressed through the collection of intents and their relationships — the shape of the graph — not a single parent document. The schema allows roots if genuinely needed. In practice, most projects are peer meshes.

### Why source maps are co-located but separate from intents

Intents are human-authored, change rarely, stay small. Source maps are maintained by the system, change on every file edit, grow with the codebase. Embedding them in intent files would make intents unreadable. Co-locating in the same directory makes the coupling structural (delete the directory, delete everything). Content-hash linking detects staleness on read without a background daemon.

### Why LLM classification over vector similarity for source maps

Vector similarity computes embedding distance between constraint text and code. This is fragile because natural language constraints and source code share minimal lexical surface. "Events should include correlation IDs for distributed tracing" does not embed near `const correlationId = headers['x-correlation-id']`. LLM-based structured classification — giving a model the constraint text and a code file, asking "does this file implement or relate to this constraint?" with structured output — is fundamentally more capable because the model reasons about the semantic relationship rather than measuring surface distance. Vector similarity remains in the pipeline as a cheap gap-filler, not as the primary mechanism.

### Why explicit annotations are the highest-priority mapping

A `// @intent pag-001` comment in source code provides near-deterministic mapping at near-zero developer cost. It's the kind of marker engineers naturally add anyway ("this implements the pagination requirement"). Making it a recognized convention that the system parses means teams can invest in precise mapping where it matters most, while the AI pipeline handles the rest. Annotations are never required — the system works without them — but it rewards them with the highest mapping confidence.

### Why source maps track provenance

Not all mappings are equally trustworthy. An annotation-sourced mapping is near-deterministic. An LLM-classified mapping depends on model judgment. An embedding-similarity mapping is the least reliable. Tracking provenance per mapping (annotation, llm-classified, dependency-analysis, path-convention, embedding-similarity) lets the verifier calibrate trust — tightly scoping checks for high-provenance mappings, casting a wider net for low-provenance ones — and helps identify where accuracy improvements are most needed.

### Why source maps are JSON, not YAML

Machine-maintained, not human-authored. JSON is faster to parse and write — matters for PostToolUse hook performance. Readable enough for PR review. Not meant for hand-editing.

### Why composition distinguishes additive and destructive operations

A false-positive dedup merge silently removes a constraint from enforcement. A wrong concern assignment puts a constraint in the wrong facet. These are not the same risk. Destructive operations (dedup_merge, obligation_inferred) change the active constraint set or enforcement semantics — mistakes cause silent data loss. Additive operations (concern_assignment, stitch_discovered, preamble_generated, relevance_ranked) organize or annotate constraints — mistakes are recoverable without losing information. The system must apply different confidence thresholds and gating to each category.

### Why composition audits are version-controlled

AI decisions during composition can be wrong. Version-controlling the audit log means decisions are reviewable in PRs and overridable by the team. "The composition flagged X and Y as duplicates — I disagree" is a PR comment, not a mystery. Transparency is the product.

### Why scope conflicts surface as blocking tensions, not silent overrides

Silent override is antithetical to the system's purpose. If a narrower scope quietly weakens a `must`-level constraint from a broader scope, the system has hidden exactly the kind of decision it exists to surface. All scope conflicts — contradictions, weakening of obligation levels, same-scope disagreements — surface as blocking tensions requiring explicit resolution with rationale. This extends the existing pattern for Block-level `conflicts-with` and makes the system consistently transparent about every decision that affects which constraints are enforced.

### Why constraints carry a verifiability class

Constraints fall into two distinct difficulty classes for AI verification. Mechanical constraints (pattern-level, code structure) are verifiable at high accuracy. Semantic constraints (architectural reasoning, distributed behavior) produce significantly lower and more variable accuracy. Reporting both with the same confidence framing creates a vanity metric. Separating adherence reporting by class lets teams know which numbers they can trust and where human judgment is still needed. The class is author-assigned on Blocks and AI-inferred for project-specific constraints.

### Why verification requires model diversity

Three instances of the same model share the same systematic blindspots. If the model cannot reason about distributed transaction topology, three copies produce three copies of the same wrong answer with high agreement — which the system reports as confident consensus. Requiring at minimum two distinct models in the verification pool mitigates shared blindspots. The ceiling this creates is explicitly acknowledged rather than hidden behind a false consensus signal.

### Why transitive dependencies use cycle detection, not a fixed hop cap

Real dependency chains in microservice systems routinely exceed 3 hops (API gateway → auth → user → permissions → policy → data). A hard cap silently excludes relevant constraints from resolution. Silent exclusion in a trust system is a design error. Cycle detection (terminate any path that revisits a node) addresses the real risk — infinite recursion — directly. A configurable depth limit (default: 10) serves as an operational safety valve. When the limit truncates, the system surfaces it in the manifest. No silent truncation.

### Why two-level presentation (Manifest + Facets)

One level doesn't scale past 10 Blocks. Three levels add navigation decisions AI agents handle poorly. Two levels match how both humans and agents navigate: scan the overview, drill into what matters.

### Why concern-based grouping

An agent implementing "account deletion" doesn't care which Block a constraint came from. It cares about the concern: soft-delete, event-sourcing, audit-trail. Concern-based grouping puts related constraints together regardless of origin.

### Why stitches instead of chains

Chains are prescriptive: "do step 1, then step 2." Stitches are diagnostic: "this interacts with that — here's what breaks." Chains assume an implementation sequence the system can't prescribe. Stitches leave sequencing to the agent.

### Why multi-agent discourse for verification

A single pass misses edge cases and lacks confidence calibration. Multiple agents with structured discourse mirrors high-performing architecture review. The consensus mechanism provides a natural confidence signal.

### Why a bounded evaluation protocol

Without convergence guarantees, multi-agent verification creates doom loops. The bounded protocol (full first round, scoped re-evaluation, locked finding set, deferred new observations) mirrors high-performing teams: fixed rubric, bounded rounds, scoped re-review. Finding set can only shrink.

### Why system-wide adherence, not per-PR review

The system has an intended state and an actual state. That question is always system-wide. A PR changes the actual state. A new intent changes the intended state. Both update the same picture.

### Why lifecycle hooks, not manual invocation

An instruction in a CLAUDE.md is a suggestion. A lifecycle hook is a deterministic checkpoint. Context injection, source map linking, and verification happen automatically every time.

---

## Part 7: Vocabulary

| Term | Definition |
|---|---|
| **Block** | Community-authored, registry-stored canonical pattern. Declares constraints for a single architectural concern. |
| **Intent** | Project-level artifact composing Blocks with project-specific requirements at a given scope. Lives in the repo as `intent.yaml`. |
| **Constraint** | Single falsifiable statement about the software. Has obligation level and verifiability class. The atomic unit of the system. |
| **Obligation** | Enforcement level: `must` (defect), `should` (warning), `may` (option). Determines verification behavior and truncation priority. |
| **Verifiability Class** | Difficulty class for AI verification: `mechanical` (pattern-level, high accuracy) or `semantic` (architectural reasoning, lower/variable accuracy). Determines adherence reporting separation, cost-tiering of verification models, and trust calibration. |
| **`relates_to`** | Relationship declaration on a Block or Intent. Carries type, rationale, optional constraint pairs. Same structure at both levels. |
| **Decision Point** | Inherent choice within a Block that adopters must resolve. Named options with descriptions. |
| **Scope** | Slash-delimited hierarchical namespace. Hierarchy optional — most graphs are peer meshes. Scope conflicts surface as blocking tensions, not silent overrides. |
| **Intent Graph** | Emergent topology of all Intents and their relationships. A connected mesh of peers. Derived from reading all intent directories and their adopted Blocks. |
| **Source Map** | Bidirectional links between an intent's constraints and implementation files. Co-located `source-map.json` per intent directory. Built via a multi-mechanism pipeline (annotations → LLM classification → dependency analysis → path conventions → vector similarity). Content-hash linked for staleness detection. Each mapping carries provenance. |
| **Mapping Provenance** | How a source map link was established: `annotation`, `llm-classified`, `dependency-analysis`, `path-convention`, or `embedding-similarity`. Determines trust calibration. |
| **Intent Annotation** | A `// @intent <constraint-id>` marker in source code. Highest-priority, near-deterministic mapping signal. Never required, always rewarded with highest confidence. |
| **Composition Audit** | Record of every AI decision during constraint composition. Distinguishes additive (recoverable) and destructive (data-loss risk) operations. Co-located `audit.json` per intent directory. Version-controlled. |
| **Manifest** | Top level of composed output. Under 600 tokens. The agent's table of contents. |
| **Facet** | Detail level of composed output. One per concern. 300–1,000 tokens. Retrieved on demand. |
| **Stitch** | Inline cross-reference on a constraint within a Facet, with failure description. |
| **Density Valve** | Cap on inline failure hints per constraint. Overflow queryable on demand. |
| **Concern** | Cross-cutting topic grouping related constraints. Formed by AI clustering during composition. |
| **Tension** | Design conflict — between Blocks, between Intents, or across scope boundaries — requiring explicit team decision with rationale. |
| **System Adherence State** | Persistent collection of per-constraint verdicts in `.ia/adherence/`. Separated by verifiability class. Gitignored, rebuilt from audits. |
| **Verdict** | Evaluation outcome: pass, partial, fail, contested, not-applicable. |
| **Drift** | Change in adherence state over time. Verification compared across time, not a separate mechanism. |
| **Deferred Finding** | New observation during re-evaluation that doesn't block the current cycle. Queued for next cycle. |
| **Reverse Index** | Runtime lookup structure: file → constraints. Built in memory from source maps at session start. Cached in `.ia/cache/`. |

---

## Part 8: Roadmap

The detailed build roadmap is maintained as a separate document with sprint-level specifics, the NX + pnpm monorepo structure, and the head-to-head comparison plan against traditional prose specs. What follows is the phase-level summary.

### Phase 1: The Atom (Weeks 1–4)

Build the constraint format and initial Block library simultaneously. Each stress-tests the other.

**Block schema.** Finalize: constraints, obligations, `relates_to`, decision points, layer tags. Validate by expressing 10–15 real patterns.

**Intent schema.** Finalize: block composition, scope, project-specific constraints, `relates_to`, decisions.

**Source map schema.** Finalize: per-intent `source-map.json` with content-hash linking, confidence scores, unmapped tracking. Co-located in intent directories.

**Composition audit schema.** Finalize: per-intent `audit.json` with typed decisions, sources, confidence scores.

**Initial Block library.** 10–15 patterns covering the constraints AI agents most commonly violate.

**Two-level presentation format.** Manifest and Facet schemas. Token budget validation.

**Head-to-head fixture setup.** A todo app (React + ShadCN + Tailwind 4, Express + SQLite) built twice: once using intent architecture, once using traditional prose specs with equivalent content. Four peer intents (api, data, ui, auth).

**Deliverable:** An engineer can adopt Blocks into an Intent, compose them, and hand structured context to an agent. Manual workflow — no hooks, no verification.

### Phase 2: The Loop (Weeks 5–8)

Close the feedback loop with verification and lifecycle integration.

**Verification system.** Multi-agent evaluation with model diversity (min 2 distinct models). Triage. Bounded evaluation protocol. System adherence state separated by verifiability class. Cost instrumentation from day one. Rollup through intent graph.

**Seeded-violation benchmark.** Synthetic multi-service codebase with 50+ known violations at graded difficulty. Establishes detection rate per tier before verification ships. The system's accuracy credential.

**Lifecycle hooks.** Pre-execution context injection (with source map staleness detection). Post-execution source map linking via prioritized pipeline (annotations → LLM classification → dependency analysis → path conventions → vector similarity, with provenance). Stop-time verification. Hooks written into agent tool's native config.

**Context Resolver as MCP server.** The 4 tools available to both implementation and verification agents.

**Deliverable:** The full loop. Hooks inject context, link code, trigger verification. Conformance reports separated by verifiability class. Seeded benchmark establishes what the system can reliably verify. Cost curve understood.

### Phase 3: The Ecosystem (Weeks 9–14)

**Registry platform.** Block publishing, semantic search, community vetting.

**AI-assisted authoring.** Conversational composition, tension resolution, granularity discovery, delta-driven planning.

**Dashboard.** Adherence visualization separated by verifiability class, drift trends, regression alerting.

**Incremental verification expansion.** As seeded-violation benchmark data shows acceptable detection rates for additional constraint classes, expand verification scope. Each expansion validated by the benchmark before release.

---

## What Success Looks Like

A developer adopts three Blocks for a new service: cursor-pagination, soft-delete, event-sourcing. The registry's `relates_to` declarations surface a conflict between soft-delete and event-sourcing, with a decision prompt. The developer resolves it — deletion-as-event-type — and the decision is recorded in the Intent with rationale and produced constraints. They also declare a `relates_to` edge: checkout depends on billing for tax calculation. The verification system immediately evaluates the codebase: "Mechanical adherence: 38%. Semantic adherence: 22%. 14 constraints unsatisfied."

An agent starts implementing. The Pre hook loads intent directories, detects no stale source maps, builds the reverse index, composes and injects the Manifest: 8 concerns, the blocking conflict already resolved, a dependency on billing's constraints noted. The agent pulls the soft-delete Facet: 5 constraints, inline stitches pointing to event-sourcing and audit-trail with concrete failure descriptions.

As the agent creates and modifies files, the Post hook links each one to the intent graph. Some files carry `// @intent` annotations from the developer's initial scaffolding — these map deterministically. Others are classified by the LLM pipeline with structured output. Dependency analysis fills in connected files. Source maps build as a side effect of normal coding, with provenance tracked per mapping.

The agent finishes. The Stop hook flushes dirty source maps (updating `intent_hash` on each), persists the reverse index, then runs verification. Two distinct models evaluate each flagged constraint in a three-agent pool. Of 14 flagged constraints, the 9 mechanical constraints show strong agreement — 8 pass, 1 fails. The 5 semantic constraints are harder: 2 pass with full agreement, 1 passes with a 2-1 split, and 2 are contested (agents disagree on whether the implementation satisfies the architectural intent). The contested findings are surfaced for human review — not hidden behind a blended percentage.

The conformance report shows: "Mechanical: 89% (8/9 pass, 1 fail). Semantic: 40% (2/5 pass, 2 contested, 1 fail)." The developer addresses the mechanical failure (straightforward — wrong pagination pattern). The semantic failures require more thought. One contested finding (saga coordination) the developer reviews and accepts as-is with rationale: the implementation approach differs from what the agents expected but satisfies the constraint's intent. The other contested finding reveals a genuine gap — no compensation transaction on the timeout path. The developer fixes it.

Scoped re-evaluation runs — only previously-failing and contested constraints, finding set locked. The mechanical failure resolves. The semantic fix resolves. The accepted-as-is finding is recorded with rationale. Updated adherence: "Mechanical: 100%. Semantic: 80% (1 accepted deviation recorded)."

Six months later, a full system audit catches cursor-pagination violations in two endpoints — introduced by a refactor, missed during review because the files were edited outside the hook system. The audit rebuilds source maps from scratch (the new files had no `// @intent` annotations, so LLM classification maps them), catches the regression, and the dashboard shows it. The team fixes it in the next sprint.

The dashboard tells the story over time, always separated by verifiability class: order-management mechanical adherence has held at 98%+ for four months; semantic adherence has stabilized at 80% with three accepted deviations recorded. Notifications mechanical adherence climbed from 38% to 100% over three weeks; semantic adherence climbed from 22% to 75% with two contested findings under ongoing discussion. The team knows exactly which numbers they can trust and where human judgment is still needed.

The spec didn't rot. The spec *worked* — and was honest about what it could and couldn't verify.
