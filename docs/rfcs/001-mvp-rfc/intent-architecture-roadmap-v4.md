# Intent Architecture — Build Roadmap

**Date:** 2026-03-17
**Version:** Roadmap v4
**Monorepo:** NX + pnpm
**Project:** `dusk`

---

## Repository Structure

```
dusk/
├── packages/
│   ├── core/
│   │   ├── schema/                # Types, validators, enums
│   │   ├── parser/                # Read/write block, intent, config YAML
│   │   └── graph/                 # Intent graph traversal and queries
│   │
│   ├── engine/
│   │   ├── composition/           # Blocks + intents → manifest/facets
│   │   ├── embeddings/            # Vector embedding and similarity
│   │   └── source-map/            # PostToolUse linking pipeline
│   │
│   ├── delivery/
│   │   ├── mcp-server/            # MCP tools for agent consumption
│   │   └── hooks/                 # Hook generators per environment
│   │
│   ├── verification/
│   │   ├── triage/                # Fast pre-filter
│   │   ├── evaluator/             # Multi-agent evaluation + discourse
│   │   ├── adherence/             # Persistent state + rollup + reporting
│   │   └── protocol/              # Bounded evaluation loop
│   │
│   ├── platform/
│   │   ├── registry/              # Block publishing, search, vetting
│   │   ├── authoring/             # AI-assisted intent composition
│   │   └── dashboard/             # Adherence visualization + drift
│   │
│   └── cli/                       # Developer-facing commands
│
├── blocks/
│   └── canonical/                 # The curated block library
│       ├── cursor-pagination.block.yaml
│       ├── soft-delete.block.yaml
│       ├── event-sourcing.block.yaml
│       ├── api-idempotency.block.yaml
│       ├── input-validation.block.yaml
│       ├── error-handling.block.yaml
│       ├── rate-limiting.block.yaml
│       ├── auth-boundaries.block.yaml
│       ├── caching-strategy.block.yaml
│       ├── saga-orchestration.block.yaml
│       ├── optimistic-updates.block.yaml
│       └── audit-trail.block.yaml
│
├── fixtures/
│   ├── README.md                  # Fixture conventions
│   │
│   ├── todo-intents/              # Built using intent architecture
│   │   ├── ia.config.yml          # Tool configuration
│   │   ├── .ia/
│   │   │   ├── intents/
│   │   │   │   ├── todo--api/
│   │   │   │   │   ├── intent.yaml
│   │   │   │   │   ├── source-map.json
│   │   │   │   │   └── audit.json
│   │   │   │   ├── todo--data/
│   │   │   │   │   ├── intent.yaml
│   │   │   │   │   ├── source-map.json
│   │   │   │   │   └── audit.json
│   │   │   │   ├── todo--ui/
│   │   │   │   │   ├── intent.yaml
│   │   │   │   │   ├── source-map.json
│   │   │   │   │   └── audit.json
│   │   │   │   └── todo--auth/
│   │   │   │       ├── intent.yaml
│   │   │   │       ├── source-map.json
│   │   │   │       └── audit.json
│   │   │   ├── cache/             # Gitignored
│   │   │   │   ├── reverse-index.json
│   │   │   │   ├── embeddings.db
│   │   │   │   └── composition/
│   │   │   └── adherence/         # Gitignored
│   │   │       └── state.db
│   │   ├── api/                   # Express + SQLite
│   │   │   ├── package.json
│   │   │   └── src/
│   │   └── ui/                    # React + ShadCN + Tailwind 4
│   │       ├── package.json
│   │       └── src/
│   │
│   └── todo-baseline/             # Built using traditional specs
│       ├── specs/                 # Long-form markdown specs
│       │   ├── api-spec.md
│       │   ├── data-spec.md
│       │   ├── ui-spec.md
│       │   └── auth-spec.md
│       ├── api/                   # Same tech stack
│       │   ├── package.json
│       │   └── src/
│       └── ui/                    # Same tech stack
│           ├── package.json
│           └── src/
│
│   └── seeded-benchmark/          # Verification accuracy benchmark
│       ├── ia.config.yml
│       ├── .ia/
│       │   └── intents/           # Intents covering all seeded violations
│       ├── services/              # 3-4 synthetic services
│       │   ├── order-service/
│       │   ├── payment-service/
│       │   ├── notification-service/
│       │   └── inventory-service/
│       └── violations.manifest.yaml  # Ground truth: all seeded violations
│                                     # with location, type, and difficulty tier
│
├── nx.json
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

---

## The .ia Directory

All intent architecture data lives in `.ia/` at the project root, configured by `ia.config.yml`. The directory separates authored intent content from derived runtime data.

Each intent is a directory under `.ia/intents/` containing its authored intent file, its AI-maintained source map, and its composition audit log. The directory is the atomic unit — delete it and everything about that intent is gone.

```
.ia/
  intents/                             # All intent directories
    todo--api/                         # One directory per intent
      intent.yaml                      #   Authored knowledge
      source-map.json                  #   AI-maintained, content-hash linked
      audit.json                       #   Composition decisions
    todo--data/
      intent.yaml
      source-map.json
      audit.json
    todo--ui/
      intent.yaml
      source-map.json
      audit.json
    todo--auth/
      intent.yaml
      source-map.json
      audit.json
  cache/                               # Gitignored: derived runtime data
    reverse-index.json                 #   file → constraints (built from source maps)
    embeddings.db                      #   Vector store for constraint text
    composition/                       #   Cached manifests/facets
  adherence/                           # Gitignored: system-wide verdict state
    state.db
```

**Version-controlled:** Everything under `.ia/intents/`. Intent files, source maps, and audit logs are shared knowledge the team reviews in PRs.

**Gitignored:** `.ia/cache/` (derived, rebuildable) and `.ia/adherence/` (rebuilt from full audits).

**Source map consistency:** Each `source-map.json` stores the content hash of the `intent.yaml` it was last synced against. Staleness is detected on read — when any tool loads a source map, it compares the stored hash to the current intent file. If they differ, the source map is flagged as stale. No background daemon required.

---

## ia.config.yml

Root-level tool configuration. Lives alongside the project's source code.

```yaml
version: 1
blocks:
  source: ../../blocks/canonical   # Path to block library (or registry URL)
intents:
  dir: .ia/intents                 # Where intent directories live
scope_root: todo                   # Namespace prefix for this project
hooks:
  tool: claude-code                # Agent tool to generate hooks for
  source_map:
    confidence_threshold: 0.6      # Below this, flag as unmapped
verification:
  agents: 3                        # Number of evaluation agents
  triage: true                     # Enable pre-filter
storage:
  adherence: .ia/adherence/state.db
  cache: .ia/cache/
```

---

## The Four Intents (Todo App)

There is no root intent. The intent graph is a connected mesh of peers. Each intent governs a genuine architectural concern.

**`todo--api`** — REST API layer. Adopts cursor-pagination, api-idempotency, input-validation, rate-limiting. API-specific constraints: route naming, response envelope structure, status code usage, error response format. Relates to todo--data (depends-on: API depends on data layer contracts). Relates to todo--auth (depends-on: API must enforce auth boundaries).

**`todo--data`** — Data and persistence layer. Adopts soft-delete. Data-specific constraints: migration strategy, schema conventions, query patterns, connection management, transaction boundaries. Relates to todo--api (the data contracts the API depends on).

**`todo--ui`** — Frontend layer. Adopts optimistic-updates. UI-specific constraints: component structure, form validation, error display, loading states, accessibility. Relates to todo--api (depends-on: UI consumes API contracts). Relates to todo--auth (depends-on: UI renders auth state).

**`todo--auth`** — Authentication and authorization. Adopts auth-boundaries. Auth-specific constraints: session management, token handling, permission checking, protected route patterns. Relates to todo--api and todo--ui (constrains both).

---

## Evaluation Strategy

Three evaluation methods vet different layers of the system. Each is necessary. Skipping any one leaves a critical question unanswered.

### Evaluation 1: Ergonomic Proof — Todo App

**Purpose:** Validate the end-to-end UX of the constraint system. Does the authoring flow work? Do the lifecycle hooks integrate cleanly? Do the MCP tools respond correctly? What does the experience feel like?

The todo app (React + ShadCN + Tailwind 4, Express + SQLite) is the vehicle. It's small enough to complete quickly and simple enough that friction is attributable to the system, not to problem-domain complexity.

**todo-intents:** Built using intent architecture with hooks active. The agent receives manifest/facet context automatically. Source maps maintained throughout.

**todo-baseline:** Built using traditional prose specs with equivalent content. Same requirements, same tech stack, same agent. Specs included via CLAUDE.md. This is a directional signal — not a controlled benchmark — for whether structured constraints produce meaningfully different agent behavior than prose specs.

**Deliverable:** Qualitative assessment of authoring ergonomics, hook integration reliability, context delivery quality. Directional comparison against prose-spec baseline.

### Evaluation 2: Seeded-Violation Benchmark — Synthetic Multi-Service Codebase

**Purpose:** Produce hard numbers on verification accuracy by verifiability class. This is the primary mechanism for establishing what the system can and cannot reliably verify.

**Method:** Construct a codebase of realistic structural complexity: 3–4 services with event sourcing, cross-service dependencies, real cross-cutting concerns. Seed 50+ known violations at graded difficulty:

- **Mechanical (15–20 violations):** Physical DELETE without soft-delete flag. Missing cursor parameter on list endpoint. Mutable operation on event log. Missing idempotency key header.
- **Pattern-level (15–20 violations):** Pagination endpoint returns offset results despite cursor constraint. Error handler swallows exceptions without audit. Retry logic missing backoff.
- **Semantic (15–20 violations):** Saga missing compensation on timeout path. Event handler not idempotent across service boundary. Soft-delete cascade skips dependent aggregate. Read model rebuild doesn't filter deleted entities.

**Deliverable:** Detection rate by tier. False positive rate. Contested rate by tier. These numbers determine how the verification layer is scoped and what adherence numbers actually mean.

### Evaluation 3: Real-Project Integration

**Purpose:** Validate operational viability at real scale. Ergonomic friction, source map accuracy, composition reliability, verification noise, and adoption friction are only observable under real working conditions.

**Method:** Integrate into an actual codebase for a minimum of two weeks. Author intents for real modules. Run hooks during real development. Collect data on: time spent authoring/resolving, source map accuracy, composition audit review overhead, verification signal-to-noise, and whether developers trust the numbers enough to act on them.

**Deliverable:** Quantitative operational data plus qualitative assessment of whether the system changes development behavior.

---

## Build Sequence

### Sprint 1: Schema + First Blocks

**Goal:** Define the data model and prove it expresses real patterns.

**What gets built:**

`packages/core/schema`
- TypeScript interfaces: Constraint, Block, Intent, RelatesTo, DecisionPoint, ConstraintPair, Verdict, SourceMapEntry, SourceMap, MappingProvenance, CompositionAudit, AuditDecision, IntentConfig
- Enums: Obligation, RelationshipType, Verdict, VerifiabilityClass (mechanical, semantic), MappingProvenance (annotation, llm-classified, dependency-analysis, path-convention, embedding-similarity), AuditDecisionType (concern_assignment, dedup_merge, stitch_discovered, obligation_inferred, preamble_generated, relevance_ranked), AuditDecisionCategory (additive, destructive), AuditSource (concern_hint, ai-clustered, ai-detected, ai-discovered, ai-inferred)
- Zod validators for .block.yaml, intent.yaml, source-map.json, audit.json, ia.config.yml
- Validation rules: single-sentence constraint text, obligation required, verifiability class on Block constraints (AI-inferred default for Intent constraints), IDs unique within parent, relates_to targets well-formed, semver versions
- Source map schema: intent_hash, synced_at, stale flag, mappings with constraint/files (each with path, confidence, provenance, last_confirmed), unmapped list
- Composition audit schema: intent, composed_at, composition_version, decisions array (each with type, category [additive/destructive], source, confidence, rationale). Destructive decisions below high threshold (default 0.9) flagged as pending_confirmation.
- Intent annotation convention: `// @intent <constraint-id>` — define the comment format and parsing rules

`packages/core/parser`
- Read/write .block.yaml ↔ validated Block objects
- Read/write intent.yaml ↔ validated Intent objects
- Read/write source-map.json ↔ validated SourceMap objects
- Read/write audit.json ↔ validated CompositionAudit objects
- Read ia.config.yml ↔ validated IntentConfig object
- Intent directory loader: given a path under `.ia/intents/`, load intent + source map + audit as a unit
- Clear error reporting on validation failure

`blocks/canonical/` (first 6 blocks the todo app needs)
- error-handling
- auth-boundaries
- cursor-pagination
- api-idempotency
- input-validation
- soft-delete
- Include relates_to declarations between them
- Include decision_points where relevant

`packages/cli`
- `ia init` — scaffold ia.config.yml and .ia/ directory structure (intents/, cache/, adherence/)
- `ia validate <path>` — validate a block or intent file
- `ia inspect <path>` — pretty-print with relationships

**Validated:** Schema expresses real patterns. Blocks authorable in 3–5 minutes. Verifiability class distinguishes mechanical from semantic constraints. Source map schema supports content-hash linking and mapping provenance. Composition audit schema distinguishes additive from destructive decisions. Intent annotation convention defined. Tool scaffolding works.

---

### Sprint 2: Intents + Graph + Todo App Foundation

**Goal:** Author the 4 intents, build graph traversal, scaffold both fixture apps.

**What gets built:**

`blocks/canonical/` (remaining blocks)
- rate-limiting, caching-strategy, optimistic-updates, audit-trail, saga-orchestration, event-sourcing
- Full relates_to declarations across the complete library

`fixtures/todo-intents/`
- ia.config.yml
- .ia/intents/ — 4 intent directories (todo--api, todo--data, todo--ui, todo--auth), each with intent.yaml authored with block adoption, decisions, project-specific constraints, relates_to between intents. Empty source-map.json and audit.json scaffolded.
- Scaffold Express + SQLite API structure (routes, controllers, services, models — correct structure, minimal code)
- Scaffold React + ShadCN + Tailwind 4 UI structure (components, pages, hooks — correct structure, minimal code)

`fixtures/todo-baseline/`
- specs/ — 4 prose specs covering the same constraints as the 4 intents, in traditional long-form markdown
- Scaffold identical app structure (same tech stack, same layout)

`packages/core/graph`
- Scan .ia/intents/ directories, load all intent + source map pairs
- Build the intent graph from relates_to edges (peer mesh, no root required)
- Resolve adopts (fetch blocks, expand constraints)
- Inherit relates_to from blocks into intents
- Resolve transitive depends-on with cycle detection (terminate paths that revisit a node) and configurable depth limit (default: 10 via ia.config.yml). Surface truncation when depth limit applies — no silent exclusion.
- Collect constraint-level refs
- Surface unresolved tensions (block-level conflicts AND scope-level conflicts: contradictions, obligation weakening across scopes, same-scope disagreements — all surface as blocking tensions requiring resolution)
- Query: constraints_for_scope, relationships_for_intent, unresolved_tensions, scope_conflicts

`packages/cli`
- `ia graph` — display intent graph for current project (reads ia.config.yml, scans .ia/intents/)
- `ia constraints <scope>` — list all constraints at a scope with inheritance
- `ia status` — summary of intent coverage, source map staleness, unmapped files

**Validated:** Intents compose with blocks correctly. Relationship inheritance works. Cycle detection and configurable depth work. Scope conflicts surface as blocking tensions. Graph traversal returns right constraints per scope. Both fixtures ready for implementation. The 4-intent peer graph makes sense for the todo app.

---

### Sprint 3: Composition Engine

**Goal:** Produce manifest/facet output. Manually test whether structured context helps agents implement the todo app.

**What gets built:**

`packages/engine/embeddings`
- Embed constraint text
- Cosine similarity for relevance ranking and concern clustering
- Content-hash caching (stored in .ia/cache/embeddings.db)
- Lightweight vector index by constraint address

`packages/engine/composition`
- Input: scope + intent graph + optional task description
- Steps: scope resolution → constraint accumulation → AI-assisted dedup → concern clustering (seeded + AI) → stitch generation (relates_to constraint_pairs + refs + AI-discovered) → density valve → manifest assembly (< 600 tok) → facet assembly (300–1,000 tok each)
- All AI decisions labeled with type, category (additive/destructive), source, confidence
- Destructive decisions (dedup_merge, obligation_inferred) below high confidence threshold (default: 0.9) flagged as pending_confirmation — not auto-applied. Surfaced in composition output for developer confirmation.
- Additive decisions (concern_assignment, stitch_discovered, preamble_generated, relevance_ranked) at standard threshold (default: 0.7)
- Token budget enforcement
- Output cached in .ia/cache/composition/
- Audit log written to the relevant intent directory's audit.json

`Composition black-box test suite`
- Known inputs → expected outputs for: dedup (known duplicates that should merge, near-duplicates that should NOT merge, adversarial cases with subtly different semantics), obligation inference (clear must vs. ambiguous phrasing), concern clustering (constraints with concern_hints vs. unseeded), stitch discovery (known interactions vs. unrelated constraints)
- This test suite validates composition pipeline reliability before it runs ungated on real intents. It determines whether confidence thresholds are calibrated correctly and where failure modes exist.

`packages/cli`
- `ia compose <scope>` — produce manifest + facets
- `ia compose <scope> --task "implement soft delete for todos"` — with relevance ranking
- `ia audit <scope>` — show composition decisions

**Manual validation test:**
1. Run `ia compose todo--api --task "implement CRUD endpoints for todos"`
2. Paste manifest + relevant facets into a Claude Code session
3. Have the agent implement against todo-intents fixture
4. Separately, paste equivalent prose spec into another session
5. Have the agent implement same thing against todo-baseline fixture
6. Compare: directional signal on whether structured constraints produce different agent behavior

**Validated:** Composition produces useful output. Concern clustering sensible. Destructive decisions properly gated at high confidence. Black-box test suite passing. Token budgets realistic. Audit logs capture every AI decision with type and category. First directional signal on structured vs. prose.

---

### Sprint 4: MCP Server + Hooks

**Goal:** Automate context delivery and source map maintenance. Run live agent sessions against the todo app.

**What gets built:**

`packages/delivery/mcp-server`
- 4 MCP tools: get_intent_manifest, get_facet, query_constraints, get_composition_audit
- Progressive exploration
- Composition caching

`packages/engine/source-map`
- Session startup: load all .ia/intents/*/ directories, check content hashes for staleness, build in-memory reverse index (file → constraints with provenance)
- PostToolUse mapping pipeline (priority order):
  1. Parse explicit `// @intent` annotations (deterministic, highest confidence)
  2. LLM-based structured classification: given file + candidate constraints, produce constraint IDs with confidence scores via structured output (primary AI mechanism)
  3. Dependency/import graph analysis (deterministic supplement)
  4. File path convention matching (simple heuristic)
  5. Vector similarity against constraint embeddings (gap-fill, lowest priority)
- Record provenance per mapping (annotation, llm-classified, dependency-analysis, path-convention, embedding-similarity)
- Reverse index lookup O(1) for known files, full pipeline for unknown files
- Session end: flush dirty source-map.json files, update intent_hash, persist reverse index to .ia/cache/
- Confidence scoring, unmapped file tracking

`packages/delivery/hooks`
- Hook generators that write into the agent tool's native config:
  Claude Code → .claude/settings.json hooks section
  Cursor → cursor hook config
- Pre hook (SessionStart): resolve scope from ia.config.yml, compose, inject manifest
- Post hook (PostToolUse): run source-map pipeline on changed file
- Stop hook: stub (print summary of source map changes for now)

`packages/cli`
- `ia serve` — start MCP server
- `ia hooks install` — write hooks into active agent tool's config
- `ia hooks uninstall` — remove hooks
- `ia source-map <file>` — manually run pipeline on a file
- `ia source-map status` — mapped vs. unmapped coverage, staleness report

**Build todo-intents using the live system:**
From this sprint forward, the todo-intents fixture is built through actual agent sessions with hooks active. The agent receives constraints automatically. Source maps build as the agent works. This is dogfooding.

**Build todo-baseline in parallel:**
Same requirements, same agent, prose specs in specs/ as context. Standard spec-driven workflow.

**Validated:** Automated injection works. Source maps build from live coding and stay in sync via content hashing. Hooks fire reliably. Dogfooding begins.

---

### Sprint 5: Verification Core + Seeded Benchmark

**Goal:** Multi-agent evaluation with model diversity and cost instrumentation. Establish verification accuracy by verifiability class via the seeded-violation benchmark. Run against all fixtures.

**What gets built:**

`packages/verification/triage`
- Input: diff + constraint set from source map
- Single fast agent: "does this change materially affect any of these constraints?"
- Per-constraint yes/no flag

`packages/verification/evaluator`
- 3-agent evaluation with model diversity: at minimum two distinct models in the verification pool. Cost-tiering: mechanical constraints routed to faster/cheaper models, semantic constraints to more capable models.
- Independent assessment → structured discourse on disagreement → synthesized verdict
- Agents access MCP tools for progressive context exploration (manifest → facets → queries)
- Structured output: verdict enum, evidence (file/line), reasoning, agreement level

`packages/verification/adherence`
- SQLite-backed verdict storage in .ia/adherence/state.db
- Verdicts tracked with verifiability class (mechanical/semantic)
- Rollup: constraint → concern → scope → system (weighted by obligation, **separated by verifiability class**). Dashboard shows "Mechanical: 96%, Semantic: 62% (14 contested)" — not a blended number.
- Diff queries: changes since commit/date
- Report generation: lint-style conformance report with verifiability class separation, adherence summary

`Cost instrumentation`
- Measure and log: triage pass-through rate (what percentage of constraints get flagged per code change), per-constraint evaluation cost by verifiability class and model tier, total per-PR verification cost, full audit projected cost
- Output accessible via `ia costs` — shows cost curve and identifies where the budget is spent

`fixtures/seeded-benchmark/`
- Synthetic multi-service codebase: 3–4 services with event sourcing, cross-service dependencies, real cross-cutting concerns
- 50+ seeded violations at graded difficulty:
  Mechanical (15–20): physical DELETE without soft-delete, missing cursor params, mutable event log operations, missing idempotency headers
  Pattern-level (15–20): offset pagination despite cursor constraint, swallowed exceptions without audit, missing retry backoff
  Semantic (15–20): saga missing compensation on timeout, non-idempotent event handler across service boundary, soft-delete cascade skipping dependent aggregate
- .ia/ directory with intents covering all seeded violations
- Run verification against this fixture to establish detection rate per tier

`packages/cli`
- `ia verify <scope>` — full verification, separated by verifiability class
- `ia verify <scope> --changed` — verify git-changed files only
- `ia adherence` — system-wide adherence (mechanical and semantic separated)
- `ia adherence <scope>` — scope-level
- `ia drift <scope> --since <date>` — drift over time
- `ia costs` — cost instrumentation report

**Run verification across all fixtures:**
- todo-intents: verify with hooks active during development
- todo-baseline: extract constraints from prose specs, evaluate (directional comparison)
- seeded-benchmark: run verification, measure detection rate per difficulty tier. This produces the hard numbers on what the verification system can and cannot reliably detect.

**Validated:** Multi-agent evaluation with model diversity produces actionable findings. Verdicts reproducible within verifiability class. Adherence reporting honestly separated. Cost curve understood. Seeded benchmark establishes detection rate: mechanical tier >X%, pattern tier >Y%, semantic tier >Z% (specific numbers determined empirically). These numbers determine how verification is scoped and communicated.

---

### Sprint 6: Bounded Protocol + Stop Hook + Comparison Report

**Goal:** Close the full loop. Produce the definitive head-to-head comparison.

**What gets built:**

`packages/verification/protocol`
- Round 1: full evaluation, finding set locked
- Round 2+: scoped re-evaluation only (fail/partial/contested). New observations → deferred findings. Verdicts: resolved/persists/regressed.
- Termination: all must-level resolved OR developer accepts with rationale

`packages/delivery/hooks` (update)
- Stop hook live: triage → evaluation → adherence update → report
- `ia audit --full` — full system audit, rebuilds source maps from scratch

`packages/cli`
- `ia verify <scope> --iterate` — bounded iteration loop
- `ia audit --full` — full audit
- `ia findings deferred` — show deferred findings

**Finalize all fixtures and produce evaluation results:**

*Ergonomic proof (todo app):*
Complete remaining implementation on both todo-intents and todo-baseline. Qualitative assessment of authoring ergonomics, hook reliability, context delivery quality. Directional comparison of implementation quality between approaches.

*Seeded benchmark results:*
Final detection rate report by difficulty tier and verifiability class. False positive rate. Contested rate. These numbers are the system's accuracy credential — they determine what adherence numbers actually mean and how verification is communicated.

*Summary report:*
- Per-verifiability-class adherence rates across fixtures
- Source map coverage and provenance distribution (what percentage of mappings are annotation-sourced vs. LLM-classified vs. other?)
- Bounded protocol convergence data (how many rounds to terminate?)
- Cost per PR, cost per full audit at fixture scale
- Deferred finding backlog management

**Validated:** Bounded protocol converges. Full loop works end-to-end. Seeded benchmark produces quantitative accuracy data. Cost curve understood. The system honestly reports what it can verify reliably and where human judgment is needed.

---

### Sprint 7: Real-World Validation

**Goal:** Apply to a real production codebase for a minimum of two weeks. Validate operational viability at real scale.

- Author intents for real modules in a production codebase
- Run lifecycle hooks during real daily development
- Collect specific data: time spent authoring and resolving intents, source map accuracy on real file changes (provenance distribution, false mapping rate), composition audit review overhead (how often do developers override AI decisions?), verification signal-to-noise ratio (false positive rate, contested rate by verifiability class), cost per PR at real scale, and whether developers trust adherence numbers enough to act on them
- Observe adoption friction: what's the onboarding curve? Where do developers get confused? What feels like ceremony vs. value?
- Fix issues surfaced by real-world complexity
- Document the end-to-end developer workflow

---

### Sprint 8+: Ecosystem

**Registry platform.** Block publishing, semantic search, community vetting.

**AI-assisted authoring.** Conversational intent composition, tension resolution, granularity discovery, delta-driven planning.

**Dashboard.** Adherence visualization (separated by verifiability class), drift trends, regression alerting.

**Incremental verification expansion.** As seeded-violation benchmark data shows acceptable detection rates for additional constraint classes, expand the scope of what's verified and reported with confidence. Each expansion validated by the benchmark before release.

**Additional fixtures.** More complex apps exercising different patterns: event-sourced systems, microservices, real-time apps. Each new fixture expands the seeded-violation benchmark with violations relevant to its architectural patterns.

---

## Dependency Graph

```
Sprint 1              Sprint 2
  schema (w/            graph traversal
  verifiability class,    (cycle detection,
  provenance,             scope conflict
  additive/destructive)   surfacing)
  parser                full block library
  first 6 blocks        4 intents authored
  cli: init, validate   all fixtures scaffolded
                        cli: graph, constraints, status
        │                     │
        └─────────┬───────────┘
                  ▼
            Sprint 3
              composition engine
              (additive/destructive gating)
              embeddings
              black-box test suite
              manifest / facets
              cli: compose, audit
              manual A/B: structured vs prose
                  │
                  ▼
            Sprint 4
              mcp server
              source-map pipeline
              (annotations → LLM classification →
               deps → path → vector, with provenance)
              hooks (pre + post + stub stop)
              cli: serve, hooks install, source-map
              dogfood: build todo-intents with live system
              parallel: build todo-baseline with prose specs
                  │
                  ▼
            Sprint 5
              triage, evaluator (model diversity)
              adherence (separated by verifiability class)
              cost instrumentation
              seeded-violation benchmark fixture
              cli: verify, adherence, drift, costs
                  │
                  ▼
            Sprint 6
              bounded protocol
              stop hook (live)
              full audit
              cli: iterate
              three-tier evaluation results
                  │
                  ▼
            Sprint 7
              real-world validation (2+ weeks)
                  │
                  ▼
            Sprint 8+
              registry, authoring, dashboard
              incremental verification expansion
              more fixtures + benchmark expansion
```

## Validation Checkpoints

| Sprint | Proven |
|--------|--------|
| 1 | Schema expresses real patterns. Blocks authorable in 3–5 min. Verifiability class distinguishes mechanical/semantic. Source map schema with content-hash linking and provenance works. Composition audit distinguishes additive/destructive. Annotation convention defined. Tooling scaffolds .ia/ correctly. |
| 2 | Intents compose with blocks. Relationship inheritance works. Cycle detection and configurable depth work. Scope conflicts surface as blocking tensions. Peer graph traversal correct. All fixtures scaffolded. |
| 3 | Composition produces useful output. Destructive decisions properly gated. Black-box test suite passing. Audit logs transparent. Token budgets realistic. Directional signal on structured vs. prose. |
| 4 | Hooks work in live sessions. Source maps build via prioritized pipeline (annotations → LLM classification → deps → path → vector). Provenance tracked. Content-hash staleness detection works. Dogfooding underway. |
| 5 | Multi-agent evaluation with model diversity produces actionable findings. Verdicts reproducible within verifiability class. Adherence reporting honestly separated. Cost curve understood. Seeded benchmark establishes detection rates by tier. |
| 6 | Bounded protocol converges. Full loop works end-to-end. Three-tier evaluation produces quantitative accuracy data, qualitative ergonomic assessment, and directional comparison data. |
| 7 | System works on real production codebases for 2+ weeks. Operational data collected. DX validated. Adoption friction identified and addressed. |

Each sprint validates the assumptions of the next. The sequence prevents compounding errors.
