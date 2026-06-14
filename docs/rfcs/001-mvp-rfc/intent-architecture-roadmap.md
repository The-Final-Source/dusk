# Intent Architecture — Build Roadmap v5

| | |
|---|---|
| **Supersedes** | [Roadmap v4](./intent-architecture-roadmap-v4.md) |
| **Specifies** | [Intent Architecture Proposal v9](./intent-architecture-proposal.md) |
| **Date** | 2026-05-26 |
| **Status** | Draft |
| **Assembly** | Parallel-AI-agent construction (Claude Code agents). No human time estimates. Sprints decomposed for parallelism. |

---

## Preamble — what changed vs v4

v4 was written for the v6/v7 architecture: blocks compose into intents, constraints sit inside intents, a composition engine produces manifests + facets, lifecycle hooks (PostToolUse) maintain a persisted source-map artifact, and verification runs as multi-agent discourse with model diversity.

**v9 dismantles most of that.** The architecture has reorganized around five different commitments:

1. **Intent is the atomic unit.** No blocks. No inner constraint layer. Hierarchy via the slash-namespaced path. v4's `packages/blocks/canonical/` and `packages/engine/composition/` are removed.
2. **Decoration is total.** Every statement, every block, every test carries an explicit decorator. Focal vs support distinction scopes Verifier reading per-aspect. v4's source-map pipeline is replaced by an in-memory derived index built at session start from `@intent` / `@intent-support` / `@intent-test` / `@intent-ignore` markers in code.
3. **Dusk owns the pipeline.** Lifecycle hooks (PostToolUse for source-map maintenance) are gone. Decoration is enforced by ONE mechanical core (`runGate`) at TWO boundaries: the interactive PreToolUse hook for human/direct Write/Edit, and the headless engineer's post-hoc in-process gate over its worktree diff (the headless `claude --print` engineer does not pass through the interactive hook). The full 9-step pipeline (request → bead DAG → worktrees → pair programming → shuffle sampling → tests → commit → merge → return) runs under Dusk's orchestration.
4. **Sub-agent roles are bounded, named, and configured per role.** Nine roles: Root Orchestrator, Bead Orchestrator, Decomposer, Scout, Engineer, Verifier, Test Runner, Author, Conflict Resolver. Memory scope (`none`/`bead`/`dialog`/`session`) is declared in role frontmatter and materialized by the runtime. Skills are role-bound under `.claude/skills/dusk/<role>/`.
5. **Tests are first-class intents.** Reserved suffixes `/unit-tests`, `/integration-tests`, `/e2e-tests` make test corpora child intents of impl intents. The Test Runner (9th role) runs them in Step 6 of the pipeline. Satisfaction rolls up from children to parents.

**v4 artifacts removed:**

- `packages/blocks/` (the canonical block library) → replaced by `packages/intents/canonical/` carrying canonical implementation intents (pagination, idempotency, auth, error shape, retry, etc.) at v9's hierarchical paths
- `packages/engine/composition/` (manifest/facet engine) → removed; Verifier reads decorators directly via the derived index
- `packages/engine/source-map/` (PostToolUse pipeline + persisted `source-map.json`) → removed; replaced by in-memory derived index rebuilt at session start
- `packages/engine/embeddings/` → **fully removed for v1**. v1's Author discovery uses agent-driven grep, not vector search. The substrate may return in v1.x only if/when textual search proves insufficient.
- `packages/verification/triage/` → removed; v9 Verifier runs per-aspect with scoped evidence (focal + support claimants); no triage pass needed
- `packages/verification/adherence/` SQLite DB → removed; hierarchical satisfaction is computed on-demand from the derived index
- `packages/delivery/hooks/` PostToolUse maintainer → removed; the only hook surface is the PreToolUse gate
- `composition_audit.json` artifact → removed; trace stream + commit trailers replace it
- `ia.config.yml` → restructured for v9 (intent paths, runtime config, model selection per role)
- `ia` CLI prefix → `dusk` CLI prefix (per v9 RFC Ch. 10.2)

**v4 artifacts preserved (but restructured):**

- `.ia/intents/<path>/intent.yaml` — still the home for authored intents; structure unchanged but no longer has `source-map.json` or `audit.json` sibling artifacts
- Canonical intent library — preserved as `packages/intents/canonical/`, populated with v9 hierarchical paths
- Real-world validation as the final phase — preserved, now targets dusk self-hosting first

**New in v9 (no v4 ancestor):**

- 9 sub-agent role files under `.claude/agents/dusk-*.md`
- Sub-agent skill scaffolding under `.claude/skills/dusk/<role>/`
- Bead memory materialization under `.ia/runtime/beads/<bead-id>/<role>.md`
- PreToolUse gate with 10 mechanical checks (5 from v8 + 5 new for decoration completeness; 12 typed rejection kinds). The agentic `S ⊆ D` decorate-or-decompose check is intentionally NOT in the gate — mandate enforced via Engineer proactivity + Verifier surface area
- Worktree management (Step 3) and Conflict Resolver (Step 8)
- Test Runner role + `/dusk-test` slash command + Test-Intent commit trailers
- Author role + 5-stage dialog flow + branching decisions (classify, user-response, accept-or-defer)
- Trace stream observability + `/dusk-benchmark` per-role per-model harness

---

## Architectural commitments locked for v1

These are decisions made by the proposal that the roadmap inherits without further debate. Each one collapses an option space the build would otherwise have to navigate.

| Commitment | Reference | Why locked |
|---|---|---|
| One implementation framework per project | Proposal §1.1, §10.4 | Dusk's correctness guarantees require ownership of the full request→commit path. Coexistence with OpenSpec / raw Claude Code / other orchestrators is out of scope for v1. |
| AI is the sole author | Proposal §1.2 | Code style (verbosity, decoration density, decompose-or-extract) is shaped by AI consumption. Human readability is not a target. |
| Decoration is total | Proposal §4.1 | Every statement/block inside a decorated declaration carries `@intent`, `@intent-support`, or `@intent-ignore`. No implicit coverage. PreToolUse check 6 enforces. |
| Decorate-or-decompose mandate | Proposal §1.5, §4.5 | A code unit's sub-operations must all be covered by the unit's decorator set, OR be decomposed. **Mandate enforcement is via Engineer proactivity + Verifier surfacing unsatisfied aspects (runtime) PLUS `/dusk-doctor --static-analysis` for drift detection (Sprint 9).** Mandate is NOT in the PreToolUse gate (agentic). |
| Engineer ⊥ Verifier asymmetry — falsifiable + protected | Proposal §9.2, §6.4, §7.5 | Engineer persists per bead. Verifier fresh per call. **Diagnosis flows to the Bead Orchestrator only — NEVER into the Verifier's spawn payload.** Asymmetry validated by fresh-Verifier audit benchmark in Sprint 9 with three axes (variance + rationale similarity + citation precision). Falsifiable, not asserted. |
| Sub-agent memory in frontmatter + structured dual-channel | Proposal §9.5, §9.6, §9.6.1 | Each role's `memory:` scope is declarative. Bead memory has a structured **dual-channel** format — `Approaches tried (impl)` + `Approaches tried (test-authoring)`. Compaction is **mechanical/templated only**, never LLM-summarized. Each approach carries a `Triple-slot focus` field for §3.4.1 livelock routing. |
| Sub-agent skills (advisory in v1) | Proposal §9.7 | Skills organized by role under `.claude/skills/dusk/<role>/<skill>.md`. Role prompt instructs which to load. Hard scoping deferred to v1.x. |
| Single **frontier-tier** model in v1, determinism-first (per-role override available) | Proposal §7.1, §9.5, App. D.21 | All roles default to one **frontier-tier** model; Verifier/Test-Runner verdict calls run at `temperature: 0`. v1 is not built to scale — frontier-model determinism is the priority, and tier-down/cost optimization is deferred to the Sprint-9 efficacy benchmark (which establishes whether a cheaper Engineer / faster role is warranted). The `model:` frontmatter field + `dusk.config.yml` override exists from Sprint 3. |
| Test pyramid via configurable suffixes | Proposal §3.4 | `<intent>/unit-tests`, `/integration-tests`, `/e2e-tests` are v1 defaults. **Extensible via `dusk.config.yml`** for contract/property/etc. layers. |
| Bead-id format | Proposal App. D.8 | `<prefix>_<14-digit-yyyymmddhhmmss><3-digit-seq>`. Used for Bead-id, Verdict-id, Trace-id, Test-Verdict-id. |
| Worktree branch naming | Proposal App. D.9 | `dusk/<bead-id>`. One branch per parallel bead. |
| **Long-cycle N=10 + N=2 confirmation pass on reject** | Proposal §6.5, App. D.3 | 10 random samples with confirmed-reject early-stop: on first reject, N=2 confirmation Verifiers re-evaluate the SAME tuple; ≥1/2 confirm → regression; both override → flaky verdict dismissed. Filters Verifier noise out of the regression-detection path. Confirmation data flows into fresh-Verifier audit via `confirmation_of_trace_id`. |
| PreToolUse gate: 10 hard mechanical checks | Proposal §4.6 | 10 checks (check 10 = matrix-predicate negation in `@intent-support` predicate slot per §3.1.1). No "warning" mode. No agentic checks. Hook wire format specified in §4.6.1; settings.json merge strategy with `_dusk_marker` idempotency anchor. |
| No semantic / vector / RAG layer in v1 | Proposal §5.2, §8.10 | Author Stage 2 (Discovery) uses agent-driven grep over `.ia/intents/`. No embedding substrate ships. |
| No runtime-fetched canonical intent library in v1 | Proposal §5.3, §8.11 | Author Stage 3 (Industry-Practice Injection) applies best practices from training + skill. `packages/intents/canonical/` exists as documentation examples only. |
| Long-cycle universe = direct ∪ adjacent only | Proposal §6.5 | Noun-phrase-shared expansion deferred to v1.x. v1 universe is direct (modified claims in diff) + adjacent (1-hop imports). |
| **Harness contract: 4 capabilities** | Proposal §10.3 | spawn-by-type (Task tool), PreToolUse hook, MCP host, trace emission via filesystem. Capability 5 (scoped skill discovery) is **Dusk-owned**, not harness-provided. |
| **Sub-agent spawn via Claude Code Task tool** | Proposal §9.9 | Dusk uses Claude Code's Task tool with `subagent_type: dusk-<role>`. Memory + skills materialized by Dusk BEFORE the spawn call, injected into the system prompt. |
| **Tool scoping advisory in v1** | Proposal §9.4 | Role-frontmatter `tools:` is honored as configuration, NOT as a hard sandbox. The mechanical gate (`runGate`) provides the actual decoration-safety boundary — via the interactive PreToolUse hook for direct writes, and via the headless engineer's post-hoc in-process gate over its worktree diff. Hardening deferred to v1.x. |
| **Polarity field on triples** | Proposal §3.1 | Triples carry `polarity: positive \| negative` (default positive). Slots stay affirmative; runtime inverts the LLM's affirmative verdict post-call. **The LLM never sees negation.** Replaces the earlier-draft "affirmative-only via rewriting" policy which compounded into a lexicon arms-race. |
| **Matrix/constituent parser rule** | Proposal §3.1.1 | AST-aware POS scanner — matrix-predicate negation rejected in predicate slot; constituent negation inside noun phrases (subject/object) is legal. Eliminates false positives like rejecting "a function with no required arguments." Closed lexicon: `not`, `never`, `fails to`, `lacks`, `omits`, `forbids`, `prohibits`, `prevents`, `disallows`, `excludes`, `absent`, `missing`, `devoid of`, `free of`, `denies`, `rejects`, `refuses`, `bars`. |
| **Typed `relates_to` edges (5 kinds)** | Proposal §2.1, App. A.1 | `parent`, `implies`, `conflicts`, `supersedes`, `sibling`. `refines` was collapsed into `parent` (path hierarchy expresses narrowing). Decomposer and Author act on the typed semantics. |
| **`compose: implies` operator with deterministic antecedents** | Proposal §3.2, §3.2.1 | New conditional composition with `antecedent`/`consequent` groups. **Antecedents restricted to a closed predicate vocabulary** (`is decorated with`, `claims any aspect of`, `is enclosed by a decoration of`) and evaluated by deterministic index lookup — NEVER LLM-judged. Consequents are LLM-evaluated only if antecedent holds. |
| **Quantifier vocabulary on triples** | Proposal §3.1 | `quantifier: at-least-one \| each \| exactly-one \| at-most-one \| none \| at-least-N \| at-most-N` + optional `scope:` for bound. Verifier checks cardinality explicitly. |
| **Session-snapshot derived index** | Proposal §2.10 | Index built once at pipeline entry from merge-base; immutable for the run. Per-bead in-memory delta visible only to that bead. Cross-bead queries see snapshot only. `index_snapshot_id` on every trace. |
| **Stuckness detector + iter-5 fallback + iter-15 escalation** | Proposal §6.4, §6.4.2 | Diagnosis fires on the EARLIER of (a) deterministic stuckness predicate (3-iter window of zero `verdict_delta_from_prior` + stable failing-triple set) or (b) iter-5 fallback ceiling. Early escalation at iter 15 with diagnosis as payload. Diagnosis is Bead-Orchestrator-only — never enters Verifier spawn. |
| **Per-bead 40-iter lifetime budget + 4-level recovery ladder** | Proposal §6.4.1 | Total Step-4 iterations across all re-entries capped at 40. On budget exhaustion: Level 1 partial commit (≥1 intent satisfied) → Level 2 intent-modification proposal → Level 3 operator-actionable freeze (worktree preserved; `dusk implement --resume`) → Level 4 hard abort. Bounds the Step 4↔5↔6 retry graph. |
| **File-overlap edges in Bead DAG** | Proposal §6.2 | Decomposer adds serialization edges between beads with overlapping predicted file impact. Prevents parallel writes to the same file (common with cross-cutting intent beads). |
| **Cross-bead claim overlap prevention — focal+support** | Proposal §6.2, §8.9 | Decomposer-time precondition. Focal-claim overlap is HARD refusal (`decomposer_bead_conflict`); support-claim overlap is advisory warning surfaced in run summary. |
| **Two-stage test-intent satisfaction + livelock detection** | Proposal §3.4, §3.4.1 | Test intent satisfied iff (1) Verifier confirms test body verifies what triple claims AND (2) Test Runner executes successfully. **Test-Verifier livelock detector** (same triple ≥3 iters + slot-focus ≥80% concentration + ≥3 structural test approaches) → `TestVerifierLivelockReport` → user resolves via `dusk_resolve_livelock` with one of three verbs. |
| **Verifier verdict split: focal_verdict + support_quality** | Proposal §3.3, App. A.4 | Per-triple verdict splits into `focal_verdict` (drives Engineer re-draft) + `support_quality` (advisory). Support claims gain per-claim `triple_verdict: matches \| mismatch \| vague`. Engineer gets unambiguous repair signal. |
| **Fresh-Verifier audit with 3 axes** | Proposal §7.5, §7.5.1 | Three-axis audit: verdict variance + rationale similarity + **citation precision** (structural parse of `file:line` vs seeded `ground_truth_defect_loc`). No LLM-judge in the audit itself. High-similarity × Low-precision quadrant is the rubber-stamp signature. |
| **`dusk_implement` pause/resume contract** | Proposal §10.1.1 | Decomposer-pause for unresolved intents returns `DuskError{kind: "implement_paused_for_authoring", details.resume_token}`. Harness drives `dusk_author_*` dialog; resumes via `dusk_implement({resume_token})`. Disk checkpoint, 24h TTL, single-use. |
| **`dusk_cancel` cooperative semantics** | Proposal §10.1.2 | Sets flag, drains in-flight Task calls (Claude Code Task has no abort primitive), then ordered cleanup. `CancelResult` distinguishes `cancelled[]` from `preserved[]` (already committed). |
| **MCP resources + paired fallback tools** | Proposal §10.1 | Resources for hosts that browse; paired read-only tools (`dusk_list_intents`, `dusk_get_intent`, `dusk_list_traces`, `dusk_list_beads`, `dusk_get_bead`, `dusk_list_implement_checkpoints`) for hosts that don't. |

Anything not in this table is a v1 design decision under Dusk's own ownership and may be relitigated as build progresses.

---

## Repo structure (v9)

```
dusk/
├── packages/
│   ├── core/
│   │   ├── schema/                  # Zod schemas for Intent, Triple, ComposeRule, Obligation, RelatesTo
│   │   ├── parser/                  # intent.yaml read/write + path-id consistency
│   │   ├── graph/                   # path traversal (upward parents, downward descendants), relates_to resolution
│   │   ├── decoration/              # @intent / @intent-support / @intent-test / @intent-test-file / @intent-file / @intent-ignore parser
│   │   └── index/                   # derived index — forward / reverse / focal+support / test-discovery queries
│   │
│   ├── delivery/
│   │   ├── pre-tool-use/            # PreToolUse hook — 10 mechanical checks (gate)
│   │   └── mcp-server/              # MCP tools: dusk_implement, dusk_author, dusk_status, dusk_inspect, dusk_verify
│   │
│   ├── runtime/
│   │   ├── orchestrator/            # Root Orchestrator (session memory) · Bead Orchestrator (bead memory)
│   │   ├── memory/                  # Memory scope materialization (none / bead / dialog / session)
│   │   ├── skills/                  # Role-scoped skill discovery
│   │   ├── tool-scope/              # Declared tool-scope enforcement at spawn time
│   │   │
│   │   ├── decomposer/              # Step 1: request → intent set · Step 2: intent set → bead DAG
│   │   ├── worktree/                # Step 3: parallel/serial decision · git worktree management
│   │   │
│   │   ├── engineer/                # Engineer authoring helpers (extraction suggestions, decoration completeness)
│   │   ├── verifier/                # Verifier procedure (focal+support resolution → scoped evidence → triple eval → aggregate)
│   │   ├── short-cycle/             # Step 4: Engineer + Verifier iteration loop, gate-fail loopbacks, 20-iter cap
│   │   ├── long-cycle/              # Step 5: affected universe + 3-round shuffle sampling + regression report
│   │   │
│   │   ├── test-runner/             # Step 6: Test Runner role + procedure (discover → group by layer → invoke → map to triples → verdict)
│   │   │
│   │   ├── commit/                  # Step 7: Conventional Commits + structured trailers
│   │   ├── merge/                   # Step 8: topological rebase · conflict detection
│   │   ├── conflict-resolver/       # Conflict Resolver role · git ops on decoration-aware diffs
│   │   │
│   │   ├── author/                  # Author role + 5-stage authoring flow with branching decisions
│   │   │
│   │   ├── observability/           # SubAgentTrace emission · .ia/observability/traces.jsonl writer
│   │   └── benchmark/               # Per-role per-model benchmark harness
│   │
│   ├── intents/
│   │   └── canonical/               # Bundled canonical intent library (v9 paths)
│   │       ├── api/pagination/...
│   │       ├── api/auth-required/...
│   │       ├── api/idempotency/...
│   │       ├── error-handling/...
│   │       ├── observability/...
│   │       ├── retry/...
│   │       └── ...
│   │
│   ├── fixtures/
│   │   ├── seeded-violations/       # Synthetic codebase with seeded decoration/intent violations for benchmark
│   │   └── worked-example/          # Mirror of packages/api/src/services/notifications/index.ts for regression-test fixture
│   │
│   └── cli/                         # `dusk` CLI: init, validate, inspect, verify, doctor, test, benchmark
│
├── .claude/
│   ├── agents/                      # Sub-agent role definitions (memory + tool-scope + skills frontmatter)
│   │   ├── dusk-root.md
│   │   ├── dusk-bead.md
│   │   ├── dusk-decomposer.md
│   │   ├── dusk-scout.md
│   │   ├── dusk-engineer.md
│   │   ├── dusk-verifier.md
│   │   ├── dusk-test-runner.md
│   │   ├── dusk-author.md
│   │   └── dusk-conflict-resolver.md
│   │
│   └── skills/dusk/                 # Role-bound skills (loaded only by their owning role)
│       ├── engineer/
│       │   ├── statement-extraction.md
│       │   ├── decoration-completeness.md
│       │   └── support-triple-authoring.md
│       ├── verifier/
│       │   ├── triple-evaluation.md
│       │   └── code-span-scoping.md
│       ├── test-runner/
│       │   └── vitest-invocation.md
│       ├── author/
│       │   ├── tension-detection.md
│       │   ├── discovery-grep-patterns.md       # v9 — agent-driven grep heuristics for Stage 2
│       │   ├── best-practices-application.md    # v9 — industry-practice injection for Stage 3
│       │   └── test-pyramid-proposal.md
│       ├── decomposer/
│       │   └── bead-dag-construction.md
│       └── conflict-resolver/
│           └── decorator-aware-merge.md
│
├── .ia/                             # Intent + runtime artifacts (mixed checked-in / gitignored)
│   ├── intents/                     # CHECKED IN — authored intent files
│   │   └── <intent-path>/
│   │       └── intent.yaml
│   ├── runtime/                     # GITIGNORED — per-bead persistent memory
│   │   └── beads/<bead-id>/
│   │       ├── orchestrator.md
│   │       ├── engineer.md
│   │       └── test-runner.md
│   └── observability/               # GITIGNORED — trace stream
│       └── traces.jsonl
│
├── docs/rfcs/001-mvp-rfc/
│   ├── intent-architecture-proposal.md   # v9 — the spec
│   └── intent-architecture-roadmap-v5.md # this document
│
└── (existing app packages — api, web, hooks, shared, mobile — unchanged structurally)
```

**Note on the existing app packages:** `packages/api`, `packages/web`, `packages/hooks`, `packages/shared`, `packages/mobile` are production-ready and stay as they are. They become **the target of dogfooding** in later sprints — we decorate THEIR code with v9 markers as one of the validation steps.

---

## The `.ia` directory contract

```
.ia/
├── intents/                 # version-controlled
│   └── <slash-namespaced-path>/
│       └── intent.yaml
├── runtime/                 # gitignored — recreated per session
│   └── beads/
│       └── <bead-id>/
│           ├── orchestrator.md       # Bead Orchestrator memory
│           ├── engineer.md           # Engineer memory across iterations
│           └── test-runner.md        # Test Runner memory across re-runs
└── observability/           # gitignored — ring-buffered
    └── traces.jsonl
```

Three v4 directories removed:
- `.ia/cache/` → fully removed. No composition cache, no embedding cache (v1 ships no vector substrate at all), no reverse-index file (it's in-memory)
- `.ia/adherence/state.db` → satisfaction is queried on-demand from the in-memory index
- per-intent `source-map.json` and `audit.json` siblings → replaced by trace stream + commit trailers

**Why the runtime is gitignored:** bead memory is ephemeral per-bead state. Once a bead completes (commit + merge), its memory is discarded. Cross-session continuity is not a v1 concern.

---

## `dusk.config.yml` (replaces `ia.config.yml`)

Root-level tool configuration. Minimal in v1.

```yaml
version: 1

intents:
  dir: .ia/intents                    # where intent directories live
  canonical: packages/intents/canonical  # bundled documentation examples (NOT runtime-fetched in v1)

runtime:
  bead_memory_dir: .ia/runtime/beads
  dialog_memory_dir: .ia/runtime/dialogs        # NEW v9 (Author dialog state)
  session_memory_dir: .ia/runtime/session       # NEW v9 (Root Orchestrator)
  implement_checkpoint_dir: .ia/runtime/implement  # NEW v9 (pause/resume — §10.1.1)
  traces: .ia/observability/traces.jsonl

models:
  default: claude-opus-4-8            # frontier-tier default — v1 is determinism-first, not scale-first (§7.1, App. D.21)
  verdict_temperature: 0              # Verifier/Test-Runner verdict calls run at temp 0 for determinism
  # Per-role overrides available from Sprint 3; defaults to `default` if unset.
  # Tier-down (cheaper Engineer / faster role) is a Sprint-9 efficacy-benchmark
  # optimization, not a v1 default. We optimize once we are measuring efficacy.
  overrides: {}                       # e.g. { engineer: claude-sonnet-4-6 } once benchmarked

test_runner:
  command: pnpm vitest                # how the Test Runner invokes tests
  scope_args: true                    # whether the runner accepts a scoped file list

test_pyramid:
  suffixes: [unit-tests, integration-tests, e2e-tests]  # NEW v9 — extensible

sanity:
  short_cycle_max_iterations: 20                # per-Step-4-entry ceiling
  short_cycle_diagnosis_at_iter: 5              # NEW v9 — fallback ceiling for forced diagnosis
  short_cycle_escalate_at_iter: 15              # NEW v9 — early escalation
  short_cycle_stuckness_window: 3               # NEW v9 — sliding window for §6.4.2 detector
  bead_lifetime_iterations: 40                  # NEW v9 — total across all re-entries
  long_cycle_round_count: 10                    # NEW v9 — bumped from 3
  long_cycle_confirmation_pass: true            # NEW v9 — N=2 confirmation on first reject (§6.5)
```

Anything not in this file uses runtime defaults. Authors do not configure decoration markers, role files, or the gate — those are framework-fixed.

---

## Test & determinism posture (v1 — not built to scale)

Added in implementation board round 4. v1 prioritizes determinism over scale; the test substrate reflects that.

- **Frontier model + `temperature: 0` for verdict calls.** Combined with the polarity/quantifier/deterministic-antecedent machinery (which moves the hardest logic *outside* the LLM call), single-shot structural verdicts are stable enough to assert on without scale-grade retry infrastructure.
- **Two test categories, kept apart.** *Control-flow / orchestration* tests (iteration budgets, stuckness detector, the N=2 confirmation pass and its flake-dismissal, livelock detection, the recovery ladder, cancel/drain) are driven by a **scripted-verdict Verifier double** — a test seam that returns a pre-scripted verdict sequence — so they assert pure control-flow predicates with **zero model calls**. *Verdict-correctness* tests (does the real Verifier reject offset pagination, fail a misdescribed support triple, etc.) run against the **real frontier model** on curated fixtures, asserting only structural outcomes. The double is a Sprint-1 deliverable (alongside an **injectable clock** for TTL/GC/drain determinism and **test-mode `raw_prompt` capture** in the Sprint-3 spawn pipeline).
- **Variance-dependent features use statistical thresholds.** The §7.5 fresh-Verifier audit and the §6.5 confirmation pass genuinely need sampling variance; their tests use explicit-N statistical thresholds (audit N≥10; pass bars **pre-registered** — calibrated on a held-out split, frozen before scoring), never single-shot hard asserts. The confirmation pass's *mechanism* is tested with the Verifier double; its real-model *flake rate* is characterized non-gating in Sprint 9.
- **Pragmatic, not scale-ready, CI.** Deterministic tests (the bulk) run on every change; the smaller real-model behavior cohort runs against the configured frontier model on demand and in the Sprint-9 benchmark / Sprint-10 dogfood. We do not build scale-grade test tiering for v1 — that is an optimization for when efficacy testing begins.

---

## Phases and sprints

Five phases, ten sprints. Sprints within a phase are sequential. Specific pairs of sprints across phases can be authored in parallel — see the dependency map at the end.

---

## Phase 1 — Substrate

The substrate is what the rest of the system reads and writes against. Two sprints: the intent substrate, then the decoration substrate + gate.

### Sprint 1 — Intent schema, parser, graph, derived index core

**Goal.** Make intent files first-class artifacts. Build the read path.

**What gets built.**

`packages/core/schema`
- Zod schemas for **v9 schema** (`schema_version: 2`):
  - Intent: `{id, description, obligation, compose, triples | (antecedent + consequent), relates_to[]}`.
  - Triple: `{id, subject, predicate, object, polarity?, quantifier?, scope?}` — **`polarity: positive | negative` is the structural-negation field (default `positive`).**
  - ComposeRule: `all | any | none | implies`.
  - Quantifier vocab: `at-least-one | each | exactly-one | at-most-one | none | at-least-<N> | at-most-<N>`.
  - **RelatesTo: typed edge with FIVE kinds** — `{kind: parent | implies | conflicts | supersedes | sibling, target: <intent-path>}`. `refines` removed in v9.
  - **Antecedent triple schema**: discriminated union — `predicate` slot restricted to a closed vocabulary (`"is decorated with"`, `"claims any aspect of"`, `"is enclosed by a decoration of"`); `object` must be a resolvable index reference.
- TypeScript types via `z.infer`.
- Path-to-id rule: the intent id MUST equal the slash-namespaced path from `.ia/intents/` to the file's directory.
- Reserved-suffix rule: paths ending in any suffix listed in `dusk.config.yml > test_pyramid.suffixes` resolve as test-pyramid child intents. Suffix set is configurable.
- **Migration loader** (`schema_version: 1` and early-v9 drafts):
  - Flat-list `relates_to: [string]` → `[{kind: sibling, target: <path>}]` with deprecation warning.
  - Early-v9 `kind: refines` entries → `kind: parent` (strictly stronger behavior).
  - v8 triples with `negated: true` → migrate to `polarity: negative` automatically.

`packages/core/parser`
- Read `intent.yaml` → validated Intent (v9 schema).
- Write Intent → `intent.yaml` (canonical form, deterministic field ordering, stable triple ordering by id).
- **`packages/core/parser/negation-detector.ts`** (~200 LOC, no ML dependency): lightweight POS-aware scanner implementing the §3.1.1 matrix/constituent rule:
  - **Predicate slot**: reject the full §3.1.1 lexicon — `not`, `n't`, `never`, `cannot`, `must not`, `does not`, `is not`, `do not`, `did not`, `fails to`, `refrains from`, `absent`, `missing`, `lacks`, `lacking`, `omits`, `excludes`, `forbids`, `prohibits`, `prevents`, `disallows`, `denies`, `rejects`, `refuses`, `bars`, `devoid of`, `free of`, `free from`.
  - **Subject/object slots**: reject only the sentence-level negation auxiliaries (`not`/`n't`/`is not`/`does not`/etc.) when attached to a matrix verb. Constituent negation inside noun phrases is LEGAL (`"a function with no required arguments"`, `"a sandboxed environment free of network access"`).
  - Test corpus: ~40 cases (positive examples that should pass + negative examples that should reject) at `packages/core/parser/__tests__/negation-detector.test.ts`.
- **Antecedent-grammar validation** for `compose: implies` intents: antecedent triples MUST use the closed predicate vocabulary and resolvable-reference object shape; rejected at load with `decoration_parse_error` pointing to the `dusk/author/implies-antecedent-grammar` skill.
- Atomic-write semantics (write to temp + rename).
- Clear error messages on validation failure with file:line locations.

`packages/core/graph`
- Walk `.ia/intents/` recursively, load every `intent.yaml`, resolve each to its hierarchical id.
- Path traversal: upward (parents via typed `kind: parent` edges + path-segment traversal) and downward (descendants).
- **Typed `relates_to` resolution** (five kinds):
  - `parent` → use for satisfaction rollup AND Decomposer scope expansion.
  - `implies` → record for Decomposer's auto-expansion (Sprint 5).
  - `conflicts` → record for Decomposer's bead-issue refusal (Sprint 5).
  - `supersedes` → mark target as deprecated.
  - `sibling` → context-only.
- Cycle detection on `relates_to` edges (any kind).
- Test-pyramid children resolution: given an intent `X`, look up `X/<suffix>` for each configured suffix.

`packages/core/index` (skeleton — decoration parts in Sprint 2)
- Derived index data structure. In-memory. Rebuilt at session start.
- Forward query: `intent_path → all known declarants/claimants` (empty until Sprint 2).
- Hierarchical satisfaction query: roll up child satisfaction into parent (empty until Sprint 2 verdicts exist; data structure shape locked here).
- Test-discovery query stub: `intent_path → test-pyramid-children` (already works from Sprint 1; populated with claimants in Sprint 2).

`packages/intents/canonical/` (first wave)
- Author 6 canonical implementation intents at v9 paths:
  - `api/pagination/cursor-only/cursor-decode`
  - `api/pagination/cursor-only/cursor-encode`
  - `api/pagination/page-size-bound`
  - `api/auth-required`
  - `api/idempotency`
  - `error-handling/explicit-not-silent`
- Each authored with full triples, obligations, and `relates_to` linkages where meaningful.
- These serve as **documentation examples** of how to author v9 intents, plus test fixtures for parser + graph. They are **not** runtime-fetched by Author in v1 — the Author applies industry best practices from training + skill (see Sprint 8).

`packages/cli` (initial commands)
- `dusk init` — scaffold `dusk.config.yml`, `.ia/intents/`, `.ia/runtime/`, `.ia/observability/`, and `.claude/agents/` (with stubs for the 9 role files — to be filled in Sprint 3).
- `dusk validate <intent-path>` — validate one intent or all intents.
- `dusk inspect <intent-path>` — pretty-print one intent (description, triples, obligation, relates_to, descendants).

**Sprint 1 done means.** Every authored `intent.yaml` round-trips through parser + schema cleanly. `dusk validate` catches malformed intents with file:line errors. `dusk inspect` shows hierarchical relationships. The first 6 canonical intents exist and parse.

---

### Sprint 2 — Decoration parser, derived index complete, PreToolUse gate

**Goal.** Make decoration first-class. Enforce the decoration-completeness mandate at write time.

**What gets built.**

`packages/core/decoration`
- Parser for the 6 decorator markers across TypeScript (start narrow):
  - `@intent <path> [<aspect-ids>]`
  - `@intent-support <path> [<aspect-ids>] [<subj>, <pred>, <obj>]`
  - `@intent-test <path>/unit-tests | /integration-tests | /e2e-tests [<aspect-ids>]`
  - `@intent-test-file <path>/{unit|integration|e2e}-tests`
  - `@intent-file <path> [<aspect-ids>]`
  - `@intent-ignore <path> because=(s, p, o) reason="..."`
- Extracts a decoration record per occurrence: `{file, line, scope, declaration_name | null, marker, intent_path, aspect_ids[] | null, support_triple | null, ignore_clause | null}`.
- Language extension hooks designed but not yet wired (Python, Go, Rust extensions deferred to v1.x).
- `.intent` file parser for directory-scope claims (genuinely directory-level invariants only; cross-cutting concerns go on the touching functions per RFC §2.7).

`packages/core/index` (complete)
- Reverse query: `file → intents claimed in this file`.
- Focal/support query: `(intent_path, aspect_id) → (focal_claimants[], support_claimants[])` where support claimants carry their inline NL triple. This is the load-bearing query for Verifier scoping.
- Aspect-rollup query: `intent_path → unsatisfied_aspect_ids[]` (used by `dusk_inspect`).
- Test-discovery query (full): `intent_path → test_decorators[]` keyed by pyramid layer.
- Hierarchical satisfaction: parent satisfied iff own triples pass AND every child including `/unit-tests` / `/integration-tests` / `/e2e-tests` satisfied.

`packages/delivery/pre-tool-use`
- PreToolUse hook handler implementing Claude Code's hook wire format (RFC §4.6.1, App. A.10): stdin JSON `{tool, args, session_id, transcript_path}` → stdout JSON `{decision: "approve"} | {decision: "block", reason, structured_rejection}`. Exit 0 in both cases. Process-level failures treated as "block with kind: hook_internal_error" to fail safe.
- Triggers on Write/Edit operations.
- **10 mechanical checks, ALL hard, NONE agentic** (no LLM, no semantic intent-participation analysis):
  1. Decorator present on every exported declaration.
  2. Every `@intent` / `@intent-support` / `@intent-test` references a resolvable intent path.
  3. Every aspect id resolves to a triple id in the referenced intent.
  4. One intent per line.
  5. `@intent-ignore` has both `because=(...)` AND `reason="..."`.
  6. Every statement inside a decorated declaration has decoration.
  7. `@intent-support` has a valid 3-slot triple `[subject, predicate, object]`.
  8. No statement carries both `@intent` and `@intent-support` for the same intent.
  9. `@intent-test` / `@intent-test-file` path ends in any configured pyramid suffix.
  10. **No matrix-predicate negation in `@intent-support`'s inline triple `predicate` slot** (§3.1.1 lexicon — `not`, `never`, `fails to`, `lacks`, etc.). Author must use `polarity: negative` instead. Re-uses `packages/core/parser/negation-detector.ts` from Sprint 1.
- Each rejection emits a structured payload per RFC App. A.8.
- **`dusk init` settings.json merge strategy.** Writes the hook with `_dusk_marker: "dusk-pre-tool-use-gate"` and `_dusk_managed: "v1"` as identifying fields (idempotency anchor — re-runs match by marker, not by array position or content equality). On conflict with an existing non-Dusk PreToolUse entry matching Write/Edit, surface a three-option prompt: append (recommended; both hooks run), replace (writes `.claude/settings.json.bak` + records replaced command), abort. Never silent clobber.
- **Decorate-or-decompose (`S ⊆ D`) is intentionally OUT of the v1 gate** — `/dusk-doctor --static-analysis` ships in Sprint 9 for drift detection off the write path.

`packages/cli` (decoration tools)
- `dusk doctor` (initial form) — run all 10 gate checks across the project, report violations with line precision.
- **`dusk doctor --check-hook`** — verify hook installation: settings.json present, `_dusk_marker` entry present, command path resolvable, synthetic-payload round-trip succeeds. Exit codes: 0 (all pass), 2 (configuration issue), 3 (round-trip failure).
- **`dusk doctor --check-hook --repair`** — re-runs the merge logic for configuration issues. Round-trip failures (exit 3) never auto-fix.
- `dusk inspect <file>` — show all decoration claims in a file.

**Sprint 2 done means.** Decoration markers parse correctly into structured records. Derived index supports forward, reverse, focal/support, and test-discovery queries. PreToolUse gate fires on synthetic violations of all 10 checks (including matrix-predicate negation in support triples). `dusk init` correctly handles new install, idempotent re-run, and conflict scenarios. `dusk doctor --check-hook` returns the expected exit codes per scenario.

**Parallelism note.** Sprint 2 can begin once Sprint 1's index skeleton is in place. The decoration parser and the gate handler can be authored in parallel because they share only the index data structure.

---

## Phase 2 — Sub-agent runtime + verification path

Two sprints. Sprint 3 builds the sub-agent runtime substrate (role files, memory, skills, tool scope). Sprint 4 builds the read-only verification path (MCP + Verifier procedure + `dusk_inspect`, `dusk_verify`). The two sprints can be authored in parallel.

### Sprint 3 — Sub-agent role files + memory materialization + spawn mechanism

**Goal.** All 9 sub-agent roles are spawnable via Claude Code's Task tool, with Dusk-side memory materialization and skill injection.

**What gets built.**

Role definition files under `.claude/agents/` — all 9 with the v9 frontmatter (`dusk_role_version: 2`, `memory: <scope>`, `tools: [...]` (advisory in v1), `skills: [...]`, `model: <model-id>`):

| Role file | Memory | Tools (advisory) | Skills |
|---|---|---|---|
| `dusk-root.md` | `session` | spawn workers, read status | none in v1 |
| `dusk-bead.md` | `bead` | spawn workers, git ops, trigger commit | `dusk/orchestrator/livelock-escalation-routing` (Sprint 6) |
| `dusk-decomposer.md` | `none` | Read intents, index, codebase | `dusk/decomposer/bead-dag-construction`, `dusk/decomposer/file-overlap-detection`, `dusk/decomposer/cross-bead-overlap-check` |
| `dusk-scout.md` | `none` | Read, grep, AST query | none in v1 |
| `dusk-engineer.md` | `bead` | Write/Edit (PreToolUse-gated), Read, scoped Bash | `dusk/engineer/statement-extraction`, `dusk/engineer/decoration-completeness`, `dusk/engineer/support-triple-authoring`, `dusk/engineer/convergence-diagnosis`, `dusk/engineer/test-approach-taxonomy` |
| `dusk-verifier.md` | `none` | Read only | `dusk/verifier/triple-evaluation`, `dusk/verifier/code-span-scoping`, `dusk/verifier/quantifier-checking`, `dusk/verifier/polarity-aware-evaluation`, `dusk/verifier/implies-evaluation`, `dusk/verifier/test-body-evaluation` |
| `dusk-test-runner.md` | `bead` | Read, Bash(test-runner-cmd) | `dusk/test-runner/vitest-invocation` |
| `dusk-author.md` | `dialog` | Read, Grep/ripgrep, validate, commit | `dusk/author/tension-detection`, `dusk/author/discovery-grep-patterns`, `dusk/author/best-practices-application`, `dusk/author/test-pyramid-proposal`, `dusk/author/polarity-decision`, `dusk/author/typed-relates-to`, `dusk/author/implies-antecedent-grammar` |
| `dusk-conflict-resolver.md` | `none` | Git ops, Read, Write | `dusk/conflict-resolver/decorator-aware-merge` |

**Skill tiering for Sprint 3 delivery:**

- **Tier-1 (must ship complete in Sprint 3 — load-bearing for the verification path):** `dusk/verifier/triple-evaluation`, `dusk/verifier/code-span-scoping`, `dusk/verifier/polarity-aware-evaluation`, `dusk/verifier/implies-evaluation`, `dusk/engineer/decoration-completeness`, `dusk/engineer/statement-extraction`, `dusk/author/polarity-decision`, `dusk/author/implies-antecedent-grammar`.
- **Tier-2 (ship baseline; refine during Sprint 9 dogfooding):** all other listed skills. Sprint 6 specifically refines `dusk/engineer/test-approach-taxonomy` (controlled vocabulary for livelock detection) and `dusk/orchestrator/livelock-escalation-routing` (decision tree).

Plus role-body content per RFC §9.5. **`dusk-verifier.md` ships the complete prompt template** — including:

- A **two-path execution structure** for `compose: implies` intents: "Antecedents have ALREADY been evaluated deterministically — you receive only consequent triples."
- An explicit assertion that the prompt always receives triples framed AFFIRMATIVELY (the runtime applies polarity inversion AFTER the LLM verdict — see §3.1, §3.3). The prompt has NO "invert if negated" branching; the LLM never sees a negated question.
- 2 positive + 2 negative few-shot examples drawn from RFC App. B (note: negative examples require manufacturing variants of App. B as part of Sprint 3 — see Sprint 9 fixture work for canonical seeding).

`packages/runtime/orchestrator/spawn` (NEW — RFC §9.9)
- `spawnSubAgent({role, beadId?, dialogId?, sessionId, input}) → SubAgentResult` — the canonical spawn function.
- Implementation: assemble system prompt (role body + memory + skills) → call Claude Code Task tool with `subagent_type: dusk-<role>` and the assembled prompt.
- Memory materialization happens BEFORE the Task call (Dusk-owned, not harness-owned).
- Skill injection happens BEFORE the Task call (read `.claude/skills/dusk/<role>/<skill>.md` per frontmatter list, append to system prompt).
- On return, emit SubAgentTrace event with `schema_version: 1`, `iteration_number?`, `skills_loaded[]` fields per RFC App. A.6.

`packages/runtime/memory`
- Memory scope materialization:
  - `none` — empty prior-state block in the spawn payload. Verifier traces NEVER carry diagnosis fields (the diagnosis lives in Bead Orchestrator scope only — see §6.4).
  - `bead` — read `.ia/runtime/beads/<bead-id>/<role>.md` if exists; write back on return; destroy on bead completion. **Structured dual-channel format per RFC §9.6.1** — `Current diagnosis` / `Approaches tried (impl)` / `Approaches tried (test-authoring)` / `Verifier signals` (last 3) / `Intent set in scope` / `Files being modified`. Each approach entry carries `Triple-slot focus: subject | predicate | object`.
  - `dialog` — read `.ia/runtime/dialogs/<dialog-id>/<role>.md` (Sprint 8 introduces dialog directory). Dialog lifecycle: created by `dusk_author_start`, destroyed by `dusk_author_finalize` or by `dusk doctor --gc-dialogs` if abandoned > 24h.
  - `session` — read `.ia/runtime/session/<role>.md`; persists until the Dusk session ends.
- **Compaction strategy** for memory: bead — mechanical/templated only, NEVER LLM-summarized. When "Verifier signals" has > 3 entries, the runtime collapses older entries into the relevant `Approaches tried` channel, preserving structured facts (triple_id, focal_verdict, support_quality, evidence quote, approach label, slot focus) and dropping verbose rationale only. The Bead Orchestrator owns compaction deterministically on write-back. Memory file size stays bounded regardless of iteration depth.
- **Diagnosis routing.** The Engineer's convergence diagnosis is consumed by the **Bead Orchestrator** for routing decisions (recovery ladder §6.4.1, livelock detection §3.4.1, early escalation §6.4). The Verifier's spawn payload is unchanged across iterations — preserves the Engineer ⊥ Verifier asymmetry.

`packages/runtime/skills`
- Skill discovery: read `.claude/skills/dusk/<role>/<skill-name>.md` per the role frontmatter `skills:` list.
- **Advisory scoping in v1.** The Engineer's frontmatter lists `dusk/engineer/*` skills; the runtime injects those. A misbehaving role that reads outside its directory shows up in the trace stream's `skills_loaded[]` field for post-hoc audit. Hard scoping deferred to v1.x (RFC §9.7).

`packages/runtime/tool-scope`
- **Advisory in v1** (RFC §9.4). The role-frontmatter `tools:` list is passed to Task as configuration. Claude Code honors the list as bias, not as sandbox. The PreToolUse gate (Sprint 2) provides the actual safety boundary for writes.
- Test Runner's Bash is documented as restricted to `dusk.config.yml > test_runner.command`; if the role attempts other Bash commands, the trace shows the attempt, and `/dusk-doctor` flags drift.

Baseline skill files under `.claude/skills/dusk/<role>/` per the table above. Each skill is a complete authoring guide (not a stub) — shipped baseline that projects can override.

`packages/cli`
- `dusk roles` — list installed role files, show frontmatter.
- `dusk skills` — list installed skills by role.
- `dusk doctor --gc-dialogs` — garbage-collect abandoned dialog directories older than 24h.

**Sprint 3 done means.** All 9 role files exist with valid frontmatter (including the complete Verifier prompt template with few-shots). The `spawnSubAgent` function spawns each role via Task tool with correct memory + skills injection. The Verifier confirms application-layer `memory: none` (synthetic test: spawn twice; second spawn sees no leak). The Engineer's bead memory persists across simulated iterations with the structured format. Memory file size stays bounded (synthetic test: 20 iterations → file remains < 4kb).

---

### Sprint 4 — MCP server + Verifier procedure + read-only tools

**Goal.** Verify decorated code without yet driving the pipeline. The read-only half of the integration surface.

**What gets built.**

`packages/runtime/verifier`
- The Verifier procedure per RFC §3.3:
  1. Resolve `focal_claimants[]` + `support_claimants[]` for the (intent, aspect) being verified — index query.
  2. Read scoped evidence — focal lines + each support's described location + surrounding context (NOT full file body).
  3. **For `compose: implies` intents** — evaluate the `antecedent` group by **deterministic index lookup** (no LLM call, per §3.2.1). If antecedent false → emit `accept` with `implies_antecedent_held: false`; consequents are NOT evaluated. If antecedent true → proceed to step 4 on the consequent triples.
  4. Build the Verifier prompt with the triple framed **affirmatively** (LLM never sees negation regardless of `polarity` field). For triples with `quantifier:`, prompt includes cardinality bound + scope.
  5. LLM Verifier evaluates: does `subject predicate object` hold in evidence?
  6. **Runtime polarity inversion** — after LLM verdict, invert when triple's `polarity == negative`. The LLM output is on the affirmative claim; the inverted result becomes the triple's `focal_verdict`.
  7. **Per-support-claim verdict** — for each support claim, the Verifier produces `triple_verdict: matches | mismatch | vague`. Aggregate: any `mismatch` → `support_quality: low_confidence`; ≥50% `vague` → `low_confidence`; else `ok`.
  8. Aggregate per the intent's `compose` rule (all / any / none / implies) → per-triple `{focal_verdict, support_quality}` + aggregate rationale.
- Output schema per RFC App. A.4 — gains `implies_antecedent_held?` field for implies intents; `per_triple[]` splits into `focal_verdict` + `support_quality`; support claims carry per-claim `triple_verdict`.
- By default, only failing/low-confidence supports are enumerated in `support_claims[]`; passing supports become a count `support_pass_count`.
- Verifier role spawned per call with `memory: none`. **Payload carries no iteration-specific or diagnosis content** (structural no-leak, verified against test-mode `raw_prompt` — not byte-identity per board round 4) — does NOT receive the Engineer's convergence diagnosis.

`packages/delivery/mcp-server`
- MCP server scaffolding (HTTP or stdio per Claude Code's MCP transport).
- Read-only tools:
  - `dusk_status` — `{}` → `{active_beads, recent_verdicts, recent_test_runs, index_stats}`. Returns mostly empty in Sprint 4 (no pipeline yet).
  - `dusk_inspect` — `{scope}` → `{intents, claims, support_claims, aspects_unsatisfied, test_intents}`. Wires the Sprint 2 index queries.
  - `dusk_verify` — `{diff, intents?}` → `Verdict`. Invokes the Verifier procedure against a diff or scope. Does NOT commit. Does NOT mutate state.

`packages/cli`
- `dusk inspect <scope>` — mirrors `dusk_inspect` for direct human invocation.
- `dusk verify <diff-or-scope>` — mirrors `dusk_verify`. Useful for ad-hoc checks before Sprint 5's full pipeline.

**Sprint 4 done means.** `dusk_inspect` returns correct hierarchical satisfaction + focal/support claim lists. `dusk_verify` produces accurate per-triple verdicts on the worked example (`packages/api/src/services/notifications/index.ts` once decorated per RFC App. B). The Verifier's scoped reading is verified: for a single aspect, the Verifier's input contains only the focal + support evidence, not the full function body.

**Parallelism note.** Sprint 4 can be authored in parallel with Sprint 3 — Sprint 4 depends on Sprint 2's index but not on the runtime substrate Sprint 3 builds. The MCP-tool stubs in Sprint 4 can be filled in once Sprint 3's runtime spawns Verifier correctly.

---

## Phase 3 — Implementation pipeline

Three sprints decompose the 9-step pipeline. Sprint 5 builds Steps 1-4 (decomposition + worktrees + short cycle). Sprint 6 adds Steps 5-6 (long cycle + test execution). Sprint 7 adds Steps 7-9 (commit + merge + return). Sprints within Phase 3 are sequential because each depends on the previous step's exit state.

### Sprint 5 — Decomposer, Bead Orchestrator, worktrees, short cycle (Steps 1-4)

**Goal.** Drive Engineer + Verifier through one bead end-to-end. Stop at Step 4.

**What gets built.**

`packages/runtime/orchestrator`
- Root Orchestrator. Owns the session. Spawns Bead Orchestrators per bead. Tracks the bead DAG's execution state.
- **Session-snapshot index** (RFC §2.10) built once at pipeline entry from `origin/main`. Immutable for the run. Hash recorded on every SubAgentTrace as `index_snapshot_id`. `--rebuild-index` flag forces rebuild within an existing session.
- Bead Orchestrator. Owns one worktree. Spawns Engineer, Verifier, Test Runner, Conflict Resolver as needed. Maintains the bead-local in-memory delta over the session snapshot.

`packages/runtime/decomposer`
- Step 1 (Request decomposition):
  - Decomposer spawned by Root with the user request + the session-snapshot index.
  - Walks the index to identify directly-touched intents, then walks paths upward (parents via `kind: parent` and path segments), and expands per typed `relates_to`:
    - `kind: implies` → adds target to active set automatically.
    - `kind: conflicts` → flags pair, **refuses to issue beads for both in one pipeline run**.
    - `kind: supersedes` → marks target as deprecated.
    - `kind: sibling` → context only.
  - Adds reserved test-pyramid children automatically when present.
  - Decision: `Any unresolved intent reference?` — if yes, **write checkpoint to `.ia/runtime/implement/<resume_token>.json` and return `DuskError{kind: "implement_paused_for_authoring", details: {resume_token, suggested_dialog_seed, unresolved_refs[]}}`** (NEW v9 — RFC §10.1.1). Sprint 5 stubs the `suggested_dialog_seed` to the unresolved-ref list; Sprint 8 enriches it.
- Step 2 (Bead decomp + sequencing — NEW v9 logic):
  - One bead per intent in the intent set.
  - **Dependency edges (typed)** per the relates_to kinds (five kinds — `refines` collapsed into `parent`).
  - **File-overlap edges** — pre-compute predicted file impact per bead from the session snapshot; pairs with overlapping impact get serialization edges. Reads snapshot only (not per-bead deltas).
  - **Cross-bead claim-overlap precondition (NEW v9 — Sprint 5)**:
    - **Focal-claim overlap → HARD refusal** (`decomposer_bead_conflict` per App. A.11). User must disambiguate.
    - **Support-claim overlap → advisory warning** surfaced in run summary. Not blocking.
    - Both focal and support overlap are checked (extended from focal-only per round-3 board decision).
  - Independent beads → parallel branches.

`packages/runtime/worktree`
- Step 3 (Worktree creation):
  - For each bead, parallel/serial decision per RFC §6.3.
  - If parallel: `git worktree add -b dusk/<bead-id> <path> origin/main` and spawn Bead Orchestrator in the worktree.
  - If serial: spawn Bead Orchestrator at the current worktree.
  - On Dusk crash mid-flight, `dusk doctor --cleanup-worktrees` detects orphaned `dusk/<bead-id>` branches and offers cleanup.

`packages/runtime/short-cycle`
- Step 4 (Pair programming loop) per RFC §6.4 and §6.4.2:
  - Spawn persistent Engineer (memory: bead, dual-channel structured format).
  - Iteration loop (per-Step-4-entry iter N = 1..20; per-bead lifetime budget 40 iters total):
    - **Stuckness detector evaluated after every Verifier verdict on iter ≥ 3** (RFC §6.4.2). Predicate: three consecutive iters with empty `verdict_delta_from_prior` (no flipped/new triples) AND identical `failing_triple_set`. On match → fire convergence diagnosis early.
    - **iter-5 ceiling fallback** — if the stuckness detector hasn't fired by iter 5, force the diagnosis at iter 5.
    - When fired: Engineer writes convergence diagnosis (structured: failing triple + why, intent feasibility, untried approaches) to bead memory. **The diagnosis is consumed by the Bead Orchestrator only — NEVER injected into Verifier spawn payload.** Verifier remains genuinely fresh-per-call.
    - Engineer drafts diff with full decoration.
    - PreToolUse gate runs (10 checks from Sprint 2).
    - On gate fail: Engineer fixes, re-draft. Iteration continues.
    - On gate pass: spawn fresh Verifier (memory: none; payload carries no iteration-specific or diagnosis content — structural no-leak verified against test-mode `raw_prompt`, not byte-identity).
    - Verifier evaluates per Sprint 4 procedure — polarity inverted at runtime, `implies` antecedents evaluated by index lookup.
    - On `focal_verdict: fail` on any triple: emit failed-triple list + evidence + aggregate rationale → Engineer (bead memory persists) → re-draft. `support_quality: low_confidence` is advisory only — does NOT trigger re-draft.
    - On all focal_verdicts pass: exit short cycle.
  - **iter-15 early escalation** — if not converged, surface to user with diagnosis from bead memory as the escalation payload.
- **Per-bead 40-iter lifetime budget + the COMPLETE 4-level recovery ladder (NEW v9 — RFC §6.4.1).** *(Board round 4: all four levels land in Sprint 5, not split to Sprint 9 — the split shipped a contract where a zero-satisfiable bead hard-aborted (`recoverable: false`) when the RFC says it should be `bead_intent_revision_needed` (`recoverable: true`).)* The level fired at exhaustion is a pure function of `(intents_satisfied, partial_commit_valid, freeze_writable)`:
  - **Level 1 — Partial commit** (≥1 intent satisfied AND partial commit valid). Commit subset with `Partial: true` + `Deferred-Intent: <path>` trailers. Deferred intents written to `.ia/runtime/beads/<bead-id>/deferred.yaml`. Worktree merges normally; Sprint 7 rebase logic recognizes `Partial: true` and suppresses `snapshot_drift` warnings for deferred-intent additions.
  - **Level 2 — Intent-modification proposal** (no intents satisfied OR partial commit invalid). The Engineer's final iteration produces `.ia/runtime/beads/<bead-id>/intent-proposal.yaml` aggregating ALL lifetime diagnoses. Returns `DuskError{kind: "bead_intent_revision_needed", recoverable: true}`. The *artifact + recoverable error* ship here; the *recovery action* it points to (`dusk_author_continue`) is wired in Sprint 8.
  - **Level 3 — Operator-actionable freeze** (Level 2's proposal generation itself fails). Worktree preserved; `freeze-state.md` carries bead memory + last 3 verdicts + diagnosis history. Returns `DuskError{kind: "bead_frozen", recoverable: false}`; user inspects + `dusk implement --resume <bead-id>`.
  - **Level 4 — Hard abort** (Level 3 cannot serialize freeze state — disk error). Returns `DuskError{kind: "bead_aborted", recoverable: false}`.

`packages/runtime/implement-checkpoint` (NEW v9 — RFC §10.1.1)
- Pause/resume contract. Module owns checkpoint format + read/write/GC operations.
- Checkpoint file: `.ia/runtime/implement/<resume_token>.json` carrying `{original_request, scope_hint, decomposer_partial_state, intents_resolved_so_far, intents_still_unresolved, created_at, last_touched_at}`; the Decomposer-pause error derives `{suggested_dialog_seed, unresolved_refs}` from `intents_still_unresolved`. **This JSON shape is the frozen cross-proposal interface (board round 4):** Sprint 8's Author flow *consumes* this file, so Sprint 5 pins the shape; Sprint 8 enriches `suggested_dialog_seed`'s content without changing the shape.
- `resume_token` format: `rt_<14-digit-yyyymmddhhmmss><3-digit-seq>` per RFC App. D.8.
- Lifetime 24h since `last_touched_at`. Single-use: on successful resume, deleted as the pipeline transitions out of Step 1.

`packages/runtime/observability` (extended in Sprint 5)
- Trace events emit `index_snapshot_id` (all events), `iteration_number`, `verdict_delta_from_prior`, `failing_triple_set`, `engineer_change_summary` (short-cycle), `stuckness_detector_state` (Bead Orchestrator), and `convergence_diagnosis_present` on **Bead Orchestrator traces only** (NOT Verifier traces, per the asymmetry guarantee).

`packages/runtime/cancel` (NEW v9 — RFC §10.1.2)
- `dusk_cancel` cooperative-cancellation implementation:
  - Set cancellation flag on target (`bead_id`-scoped or session-wide).
  - **Drain active Task tool calls to natural return** — Claude Code's Task has no abort primitive, so Dusk waits. Outputs received and discarded.
  - Ordered cleanup: dialogs → implement checkpoints → bead memory → worktrees with no commits (`git worktree remove`) → worktrees with bead commits preserved as `partial_commits`.
  - Already-merged commits NOT touched. Reported as `preserved.already_committed`.
  - Returns `CancelResult` per App. A.11.

MCP extension:
- `dusk_implement` — accepts `{request?, resume_token?, scope_hint?}` (exactly one of `request` or `resume_token`). On resume, reads checkpoint and continues from Step 1.
- `dusk_cancel({bead_id?, reason})` → `CancelResult`.

**Sprint 5 done means.** Given a small change request with pre-authored intents, `dusk_implement` correctly: builds the session-snapshot index, runs the Decomposer with typed-`relates_to` semantics, builds the bead DAG with file-overlap + focal/support overlap detection (focal=hard refusal, support=warning), creates worktrees, runs the short cycle to Verifier acceptance with the stuckness detector firing on synthetically-blocked beads (driven via the scripted-verdict Verifier double), and returns. The Verifier's payload is verified to carry no iteration-specific or diagnosis content (no leak — protects the asymmetry; checked against test-mode `raw_prompt`). `dusk_implement({resume_token})` resumes a paused run correctly. `dusk_cancel` drains, cleans, and reports per the contract. **The complete 4-level recovery ladder fires on synthetic exhaustion fixtures:** Level 1 partial commit when 1 of 2 intents succeeds; Level 2 `bead_intent_revision_needed` (with `intent-proposal.yaml`) when none do; Level 3 freeze when proposal generation fails; Level 4 abort when freeze can't serialize. The lifetime-budget/stuckness/recovery tests are deterministic via the scripted-verdict Verifier double + injectable clock.

---

### Sprint 6 — Long cycle + test pyramid + Test Runner (Steps 5-6)

**Goal.** Add regression detection (long cycle) and test execution (Test Runner). Pipeline now exits at Step 6.

**What gets built.**

`packages/runtime/long-cycle`
- Step 5 (Shuffle sharding) per RFC §6.5:
  - **Affected-universe computation** = direct (modified claims) ∪ adjacent (1-hop imports). **Reads the session snapshot only** — bead-local deltas excluded by design (the bead's writes are the diff under test, not the regression surface). Noun-phrase-shared expansion deferred to v1.x.
  - **N rounds (default N=10, configurable via `sanity.long_cycle_round_count`):**
    - Each round samples one random unique `(intent_path, aspect, claimant)` from universe minus already-tested.
    - Spawn fresh Verifier (memory: none).
    - **Confirmed-reject early-stop (NEW v9 — RFC §6.5):** on FIRST reject in the round set, spawn N=2 additional fresh Verifiers against the same sampled tuple (distinct call-ids; identical payload). Confirmation calls trace with `confirmation_of_trace_id: <original>` and feed Sprint 9's fresh-Verifier audit.
      - ≥1 of 2 confirm reject → regression confirmed; emit regression report; re-enter Step 4. Trace `confirmation_pass_outcome: confirmed_reject`.
      - Both override to accept → original treated as variance noise; trace `confirmation_pass_outcome: flaky_verdict_dismissed`; continue sampling.
    - Confirmation pass fires only on the FIRST reject per long-cycle round set, not on subsequent rejects — cost-bounded.
    - Stop early if universe exhausted.
  - On all-pass: continue to Step 6.
  - **Why N=10 + confirmation**: N=3 missed regressions ~73% of the time at 10% defect rate. N=10 with confirmed-reject filters Verifier variance noise from regression detection — false-positive rejects don't trigger Engineer thrashing.

Test pyramid + decoration plumbing (Sprint 2's parser already handles `@intent-test` / `@intent-test-file`; Sprint 6 wires Step 6 to it):

`packages/runtime/test-runner`
- Step 6 (Test execution) per RFC §6.6 and Drill-down "Test-execution sub-flow":
  - **Pre-execution Verifier pass on test code (NEW v9, RFC §3.4 — two-stage satisfaction):** Before the Test Runner runs anything, the Verifier evaluates whether each test body verifies what its `@intent-test` claim asserts. Uses the standard focal+support procedure on test code. A trivially-passing test (`expect(true).toBe(true)`) annotated with `@intent-test covers-persist-first` FAILS the Verifier — it has the annotation but doesn't verify the ordering. Only tests passing this Verifier check feed the Test Runner.
  - Spawn Test Runner (memory: bead, tools: Read + Bash[test-runner-cmd]).
  - Scope discovery:
    - Filter bead's intent set to test-pyramid intents (paths ending in any configured suffix — `test_pyramid.suffixes` from `dusk.config.yml`).
    - For each test-pyramid intent: query index → `@intent-test-file` claims → file paths; `@intent-test` claims → individual test names.
  - Decision: `Tests resolved AND Verifier-validated for each required test-intent?`
    - No → emit "missing or invalid tests" feedback → re-enter Step 4 to have Engineer author / fix tests.
    - Yes → continue.
  - Group test files by pyramid layer required by the bead.
  - For each layer in parallel:
    - Construct test-runner command (`pnpm vitest <file-1> <file-2> ...`).
    - Invoke via `Bash(test-runner-cmd)`. Capture pass/fail/duration per test.
  - For each test-intent triple (affirmative form per v9):
    - `covers-X`: ≥1 passing test annotated for aspect X?
    - Cardinality triples (with `quantifier` field): check matching count per the configured quantifier.
  - Compute TestVerdict per test-intent per RFC App. A.5.
  - Decision: `All test-intents pass?`
    - No → emit failing-tests report → re-enter Step 4 with failing test-intent in scope.
    - Yes → continue to Step 7.

`packages/runtime/livelock-detection` (NEW v9 — RFC §3.4.1)
- **Test-Verifier livelock detector** runs in the Bead Orchestrator after every Verifier verdict on test code.
- Trigger conditions (ALL three must hold):
  1. Same failing test-intent triple across ≥3 consecutive iterations.
  2. Verifier rationale slot-focus concentration ≥80% on a single slot (subject/predicate/object). Slot-focus extracted by deterministic keyword classifier (no LLM call) over the §3.1.1 lexicon. Classifier rules live in `dusk/orchestrator/livelock-escalation-routing` skill.
  3. Engineer structural-approach diversity ≥3, tagged via the `dusk/engineer/test-approach-taxonomy` controlled vocabulary (`mock-call-order`, `time-spy`, `state-observation`, `snapshot-of-events`, `instrumented-mock`, `dependency-injection-stub`, …).
- When triggered, Bead Orchestrator emits `TestVerifierLivelockReport` per RFC §3.4.1 schema. Bead pauses.
- New MCP tool `dusk_resolve_livelock({bead_id, verb, payload?})` resumes:
  - `accept_test_as_is` → commit proceeds with `Verifier-bypassed-test-intent` trailer.
  - `modify_triple` → scoped `dusk_author_continue` keyed to the failing triple; on finalize, Step 4 re-enters.
  - `escalate` → invokes Level 3 freeze (§6.4.1).
- Livelock detection takes precedence over budget exhaustion when both fire (richer payload).
- Trace events emit `verifier_livelock_signal` on Bead Orchestrator traces (RFC App. A.6).

MCP + slash:
- `dusk_implement` extended to run through Step 6.
- `dusk_resolve_livelock` (new MCP tool).
- `/dusk-test` slash command — invoke the Test Runner alone on a scope (synthetic bead-id; ephemeral memory).

**Sprint 6 done means.** Long-cycle universe correct for direct + adjacent. **N=10 with confirmed-reject early-stop verified**: clean diff → 10 verdicts; dirty diff with seeded regression → stops after ≤3 confirmed-reject samples on average; synthetic flaky-verdict scenario dismisses correctly via the 2-Verifier confirmation. Two-stage test satisfaction works: Verifier rejects a synthetic "trivially-passing test annotated with covers-X" before Test Runner runs. Livelock detector fires on synthetic 3-iter-same-triple-same-slot scenario; `dusk_resolve_livelock` resumes correctly for all 3 verbs. Test Runner discovers test files via index; Vitest invocation works in the dusk repo. Missing-tests and failing-tests bounces both re-enter Step 4 correctly within budget.

---

### Sprint 7 — Commit, merge, Conflict Resolver, return (Steps 7-9)

**Goal.** Full pipeline end-to-end. Atomic commits on main.

**What gets built.**

`packages/runtime/commit`
- Step 7 (Atomic commit) per RFC §6.7 and App. A.7:
  - Build Conventional Commits message: `<type>(<scope>): <subject>` + optional body.
  - Compose structured trailers:
    - `Intent: <intent-path> [<aspect-ids>]` per touched intent.
    - `Test-Intent: <intent-path>/<configured-suffix>` per executed test-pyramid intent.
    - `Bead-id`, `Verdict-id`, `Trace-id`, **`Test-Verdict-id`** (all use the App. D.8 format).
    - `Verifier-model`, `Test-Runner-model`.
    - `Long-cycle-samples` (count).
    - `Test-Suites-passed` (count).
    - **`Partial: true`** (NEW v9 — present when commit was produced via Recovery Ladder Level 1 per §6.4.1).
    - **`Deferred-Intent: <path>`** (NEW v9 — one per intent deferred in a Level 1 partial commit).
    - **`Verifier-bypassed-test-intent: <path>[<triple_id>]`** (NEW v9 — present when livelock was resolved via `accept_test_as_is` per §3.4.1).
  - One commit per bead.
  - **Cancellation interaction**: Step 7 is skipped for beads with the `dusk_cancel` flag set. Their commits surface in `dusk_cancel`'s `partial_commits` return for user decision (no auto-merge).

`packages/runtime/merge`
- Step 8 (Worktree merge) per RFC §6.8:
  - Topologically order worktree branches per the bead DAG.
  - For each branch in order: `git rebase dusk/<bead-id>` onto main.
  - **Recognize `Partial: true` trailers (NEW v9)**: if drift detected against the session snapshot, but the drift consists solely of the bead's own deferred-intent additions, suppress the `snapshot_drift` warning. True drift (concurrent main updates not from this bead) still triggers Conflict Resolver.
  - Decision: `Rebase conflict?`
    - Yes → spawn Conflict Resolver.
    - No → continue.
  - On Conflict Resolver completion: resume rebase.
  - Cleanup: `git worktree remove dusk/<bead-id>` (preserved branches from `dusk_cancel`'s `partial_commits` are NOT cleaned).

`packages/runtime/conflict-resolver`
- Conflict Resolver role implementation (memory: none).
- Decorator-aware merge: prefers the side whose decorators are MORE specific (more aspect ids declared, more granular paths). Equal-specificity conflicts surface as TODOs.
- Skill: `dusk/conflict-resolver/decorator-aware-merge` (already authored in Sprint 3 as stub; filled in here with the merge heuristics).

Step 9 (Return summary) per RFC §6.9:
- Output shape: `{commits[], beads_summary[], intents_touched[], test_intents_executed[], trace_ids[], total_duration_ms, total_cost_usd}`.
- MCP `dusk_implement` now returns this shape.

`packages/cli`
- `dusk implement <request>` — mirror `dusk_implement` for direct human invocation (mostly for debugging; the primary surface is the MCP tool via harness).

**Sprint 7 done means.** A small end-to-end change runs the full 9-step pipeline and produces one commit per bead on main with full trailer metadata. Parallel beads run in worktrees and merge in topological order. Conflict Resolver resolves a synthetic decorator-conflict scenario. The return summary contains all required fields.

---

## Phase 4 — Authoring

One sprint. Can be authored in parallel with Phase 3 once the runtime substrate (Phase 2) is complete.

### Sprint 8 — Author role + 5-stage authoring flow + `dusk_author`

**Goal.** Make `dusk_author` work end-to-end. Decomposer's "unresolved intent" decision in Step 1 now triggers real intent authoring instead of escalating to the user as an error.

**What gets built.**

`packages/runtime/author`
- Author role implementation (memory: dialog).
- The 5-stage authoring flow per RFC §5 and Drill-down "Authoring sub-flow" of the master diagram. Every user decision is a real branching point:

**Stage 1 — Intake & Framing**
- Receive raw user request → parse for behavior asserted, modal force, scope, success criteria, failure criteria.
- Generate candidate framing (proposed path + obligation + aspects + likely siblings).
- Present framing to user.
- Decision: `User confirms framing?`
  - No → user corrects → loopback to regenerate framing.
  - Yes → proceed to Stage 2.

**Stage 2 — Discovery & Tension Detection** (v1: agent-driven grep, NO vector search)
- **Agent-driven text search over `.ia/intents/`** using grep / ripgrep / shell tools available in the Author's tool scope. **No semantic / vector / RAG layer** — search is purely textual.
- Targeted greps on key phrases extracted from the framing (e.g., the candidate intent path's last segment, the framing's main nouns + verbs from the user's request).
- For each hit, the Author reads the matching `intent.yaml` and scans its triple slots.
- Expand 1-hop `relates_to` from top hits.
- For each match — classify into one of:
  - Direct conflict → resolution options: replace + migrate OR scope-bound coexist
  - Scope overlap → resolution options: merge OR refine to narrower aspect
  - Gray area → resolution options: refine triples OR link via relates_to
  - Adjacent concern → leave both, add relates_to
- Author encodes user-picked resolution.
- **No `packages/runtime/author/embeddings/` exists in v1.** A `dusk/author/discovery-grep-patterns` skill ships with a curated set of grep heuristics. Embedding-based discovery is deferred to v1.x (RFC §8.10).

**Stage 3 — Industry-Practice Injection** (v1: NO canonical-library lookup)
- **Identify the technology stack involved** in the user's framing (REST API, event-sourced aggregate, pub-sub channel, feature-flagged rollout, etc.).
- **Apply industry best practices from the Author's training** + a `dusk/author/best-practices-application` skill (idempotency conventions, cursor opacity, validation boundaries, retry shapes, observability conventions, etc.).
- **Grep prior intents in this project** for similar shapes (the Author learns from what's already authored).
- Propose decomposition that fits the framing (parent + children outline) OR signal "no match — greenfield".
- Decision: `User response to proposal?`
  - Accepts → use scaffold as-is
  - Edits → apply user's edits to scaffold
  - Rejects → greenfield path (no pretending)
- **No bundled canonical-pattern library is fetched at runtime in v1.** `packages/intents/canonical/` exists as documentation examples; the Author does not lookup-and-paste from it. Curated, importable intent libraries are deferred to the registry ecosystem in Sprint 10+ (RFC §8.11).

**Stage 4 — Drafting (hierarchical · NEW v9: test pyramid)**
- For each intent in the proposed set: draft id + description + obligation + compose + triples + relates_to.
- Apply granularity rule.
- Decision: `Implementation intent?`
  - Yes → propose test-pyramid children (`<X>/unit-tests`, `<X>/integration-tests`, `<X>/e2e-tests`) with canonical `covers-X` and `no-Y` triples per layer.
  - No → skip test-pyramid (abstract parent or structural directory invariant).
- User picks required pyramid layers (any subset of {unit, integration, e2e}).
- Present full intent set for review.
- Decision: `User accepts whole set?`
  - Yes → proceed to commit all.
  - Defers some children → commit accepted subset, record deferred as TODO.

**Stage 4.5 — Polarity decision + typed relates_to encoding + antecedent grammar** (NEW v9)
- Before drafting, the **`dusk/author/polarity-decision` skill** (replaces the earlier-draft `affirmative-phrasing` skill) instructs the Author: "Write each triple's slots affirmatively, then set `polarity: negative` if you mean 'this must NOT hold.' Do not embed negation in the English." The runtime handles inversion outside the LLM call — the Author doesn't have to invent awkward phrasings.
- The **`dusk/author/typed-relates-to`** skill instructs the Author to emit typed `relates_to` edges (`kind: parent | implies | conflicts | supersedes | sibling`) — the v9 five-kind set. Drops the `refines` decision branch (collapsed into `parent`).
- The **`dusk/author/implies-antecedent-grammar`** skill instructs the Author on the closed antecedent predicate vocabulary for `compose: implies` intents (`is decorated with`, `claims any aspect of`, `is enclosed by a decoration of`) and the resolvable-reference object shape.
- The Sprint 1 parser rejects matrix-predicate negation per §3.1.1 at write-back, antecedent-grammar violations, and unresolvable references — bounces back to the Author for refinement.

**Stage 5 — Commit Intent Files**
- Validate each `intent.yaml` against the v2 schema (typed relates_to, polarity-aware triples, quantifiers, compose: implies with antecedent grammar).
- Write `intent.yaml` files atomically to `.ia/intents/<path>/`.
- Update typed `relates_to` on existing intents with new edges (e.g., a new intent that `implies` an existing one — Author proposes the reciprocal edge if applicable; user confirms).
- Refresh derived index — new intents immediately resolvable from decorators. (Session-snapshot index is rebuilt at the next `dusk_implement` call; current run resumes via `resume_token` per §10.1.1.)
- NO code changes happen during authoring.
- Return to Decomposer (Step 1) to resume request decomposition with the now-resolvable intent set.

MCP + slash (continuation-style for v9 — RFC §10.1):
- **`dusk_author_start`** — begin a dialog, return the first question + `dialog_id`. Creates `.ia/runtime/dialogs/<dialog-id>/`.
- **`dusk_author_continue`** — accept a user response keyed by `dialog_id`, advance the stage, return next question.
- **`dusk_author_finalize`** — commit authored intents at end of Stage 5. Returns `{intents_created[], test_pyramid_children_created[], dialog_transcript_path}`. Destroys dialog directory.
- `/dusk-author` slash command — thin wrapper that orchestrates the 3 calls from the user side.

Wire to Decomposer:
- Sprint 5's Decomposer escalation point ("Any unresolved intent reference? → yes") now invokes `dusk_author_start` via Root, holds the pipeline state, and resumes Decomposition after `dusk_author_finalize` returns. The dialog can span multiple turns of user interaction without blocking the pipeline thread.

**Sprint 8 done means.** The 3-call continuation pattern runs the full 5-stage flow for a fresh intent request. Each branching decision surfaces to the user as a `next_question` in a `dusk_author_continue` response. Stage 5 commits intent files atomically with v2 schema (typed relates_to, affirmative triples). After authoring, Decomposer resumes with the new intents resolvable. Tested against a real intent-creation scenario (author a new intent for an existing dusk package, including a conditional intent using `compose: implies`).

**Parallelism note.** Sprint 8 can be authored in parallel with Sprints 6-7 (different code paths through the runtime; the integration point with Decomposer is a single function call already stubbed in Sprint 5).

---

## Phase 5 — Validation & ecosystem

Two sprints. Sprint 9 instruments and benchmarks. Sprint 10 dogfoods on real code and seeds ecosystem capabilities.

### Sprint 9 — Observability, benchmark, doctor, worked example

**Goal.** Measure what the pipeline does. Validate the canonical worked example. Establish detection-rate baselines.

**What gets built.**

`packages/runtime/observability`
- `SubAgentTrace` emission per RFC App. A.6:
  - Every sub-agent call writes one trace event with `schema_version: 1`, role, invocation_site, model, token counts, latency, cost.
  - Short-cycle traces include `iteration_number`, `verdict_delta_from_prior`, `engineer_change_summary`, `convergence_diagnosis_present` (NEW v9 — powers "why is this bead stuck?" debugging).
  - All traces include `skills_loaded[]` (NEW v9 — post-hoc audit of skill scope).
  - Traces stream to `.ia/observability/traces.jsonl` (gitignored, ring-buffered).
  - Optional sinks: PostHog LLM analytics, OTLP (out-of-band file mirror writers).

`packages/runtime/benchmark`
- Per-role per-model benchmark harness:
  - Run a fixture (Sprint 9 seeded-violations fixture) against N models with otherwise-identical configuration.
  - Capture: per-model accuracy, per-role-per-model performance, cross-model agreement matrix on Verifier verdicts, latency, cost.
  - Output: structured benchmark report consumable by `/dusk-benchmark`.
- **`/dusk-benchmark --audit-verifier-freshness` (NEW v9, RFC §7.5, §7.5.1)** — the **three-axis** fresh-Verifier audit:
  - For each fixture in the curated set (10 known-good + 10 known-bad + 5 controversial), run N=5 independent Verifier calls with identical input.
  - **Axis 1 — Verdict variance** (Shannon entropy across the 5 verdicts).
  - **Axis 2 — Rationale similarity** (token overlap across the 5 rationales).
  - **Axis 3 — Citation precision (NEW v9, RFC §7.5.1)**: structural parse of `file:line` references in `evidence.focal_claim.lines` + regex `(\S+\.(ts|tsx|js|py|go|rs)):(\d+)` against fixture YAML's seeded `ground_truth_defect_loc: {file, line}`. Three-tier score: `aligned` (±2 lines, correct file), `adjacent` (same file >2 lines off OR 1-hop import), `unaligned`. **No LLM-judge in the audit itself** — using another LLM would re-introduce the correlation we're measuring.
  - Pass criteria on known-bad set: ≥80% of fixtures show ≥4-of-5 calls `aligned`; ≤5% show 5-of-5 `unaligned`.
  - Diagnostic-quadrant interpretation table per RFC §7.5.1 — High-similarity × Low-precision is the rubber-stamp signature.
  - **Continuous calibration via organic data**: confirmation-pass calls from Sprint 6 (tagged with `confirmation_of_trace_id`) feed the audit as a separate "organic" cohort, distinct from curated fixtures (selection-biased toward fixtures-where-first-call-rejected, but a continuous signal beyond the Sprint 9 baseline).
- `/dusk-benchmark` slash command + `dusk benchmark` CLI mirror.

`packages/cli` — `dusk doctor` (complete)
- `dusk doctor` — base run: validate role definitions vs shipped baseline; validate intent files against v2 schema; validate derived-index integrity; re-run the 10 gate checks across all source files.
- **`dusk doctor --static-analysis` (NEW v9, REPROMOTED from v1.x)** — the decorate-or-decompose (`S ⊆ D`) check:
  - Build call-graph from the project's source.
  - For each decorated unit `U`, compute `D` (intents in `U`'s decorators) and `S` (intent participations of called sub-operations via decorator lookup on the callees).
  - Where `S ⊄ D`, emit a finding with file:line + suggested decomposition.
  - **Uninstrumented-callee policy** (NEW v9 — LLM board Q1 resolution): conservative default — uninstrumented callees contribute empty intent sets (no false positives flood). The `--strict-unknowns` mode surfaces uninstrumented callees as a separate finding class `undecorated_callee` for projects ready to enforce decoration coverage.
  - **Framed as drift detection**, not real-time enforcement. Run weekly during dogfooding; surface trend (decorator-density per package, violation count over time, granularity-drift signal).
- `dusk doctor --check-hook` (with optional `--repair`) — verify PreToolUse hook installation per Sprint 2 contract.
- `dusk doctor --cleanup-worktrees` — detect + remove orphaned `dusk/<bead-id>` branches.
- `dusk doctor --gc-dialogs` — garbage-collect Author dialog directories older than 24h.
- **`dusk doctor --gc-implement-checkpoints` (NEW v9 — RFC §10.1.1)** — garbage-collect implement checkpoints older than 24h since `last_touched_at`. Matches dialog GC pattern.
- Output: structured doctor report with severity (error / warning / info) per finding.

**Recovery Ladder — all four levels shipped in Sprint 5 (board round 4):** the earlier plan to wire Levels 2 + 3 here was reversed, because the split produced a Sprint-5 contract where a zero-satisfiable bead hard-aborted (`recoverable: false`) when RFC §6.4.1 requires `bead_intent_revision_needed` (`recoverable: true`). All four levels (L1 partial commit → L2 intent-modification proposal → L3 freeze → L4 abort) now land in Sprint 5; Sprint 8 wires only L2's *recovery action* (`dusk_author_continue` consuming `intent-proposal.yaml`). Sprint 9 only *consumes* recovery artifacts in the dogfood traces — it no longer implements recovery.

`packages/fixtures/seeded-violations/`
- Synthetic codebase with seeded violations across four classes:
  - **Mechanical (gate-caught):** missing exported-declaration decorator, unresolved intent path, unresolved aspect id, multiple intents on one line, malformed `@intent-ignore` clauses, missing statement decorator inside decorated declaration, malformed support triple, `@intent` + `@intent-support` for the same intent, `@intent-test` path missing configured suffix, matrix-predicate negation in `@intent-support` predicate slot. All caught by the 10-check gate.
  - **Static-analysis (doctor-caught, NEW v9):** decorate-or-decompose `S ⊄ D` violations — sub-operations touching intents not declared on enclosing statement. Caught by `dusk doctor --static-analysis`, NOT by the gate.
  - **Verification (LLM-caught):** focal claim fails Verifier evaluation; quantifier-cardinality violations; conditional (`implies`) consequent violations on antecedent-true cases; negative-polarity triple where the affirmative claim actually holds (i.e., the `polarity: negative` should reject); test-intent failures (`covers-X` unsatisfied).
  - **Two-stage test failures (NEW v9):** test code annotated with `@intent-test covers-X` but the test body doesn't verify X (trivially-passing `expect(true).toBe(true)`). Caught by the Verifier's test-code evaluation, not by the Test Runner.
- ~60 violations across these classes. Each fixture YAML carries:
  - `ground_truth_outcome: gate_reject | static_analysis_finding | verifier_reject | two_stage_test_reject | test_intent_runtime_fail`
  - **`ground_truth_defect_loc: {file: string, line: number}`** (NEW v9 — required for the citation-precision axis of the fresh-Verifier audit per §7.5.1).
- Used by `dusk benchmark` to establish detection rates. The mechanical class should be 100% caught; other classes establish the system's actual accuracy ceiling.

`packages/fixtures/worked-example/`
- Mirror of `packages/api/src/services/notifications/index.ts`.
- Decorated per RFC App. B (the canonical clean-decoration rewrite).
- Used as a fixture for `dusk verify` regression testing — every PR validates the worked example still verifies cleanly.

**Sprint 9 done means.** Trace stream emits one event per sub-agent call with all v9 fields (`index_snapshot_id`, `confirmation_of_trace_id`, `confirmation_pass_outcome`, `stuckness_detector_state`, `verifier_livelock_signal`, dual-channel `failing_triple_set`, etc.). `/dusk-benchmark` produces per-model accuracy data across all 4 violation classes. **Fresh-Verifier audit produces interpretable three-axis data** (variance + similarity + citation-precision) on the curated fixture set AND organic confirmation-pass data from the dogfood pipeline. **`/dusk-doctor --static-analysis` catches all seeded `S ⊄ D` violations and produces a baseline density report** with conservative + `--strict-unknowns` modes. The fresh-Verifier audit scores against **pre-registered** pass bars (calibrated on a held-out split, frozen before the known-bad set is scored), with explicit numeric bars on all three axes and N≥10. (The full recovery ladder was already gated in Sprint 5.) `dusk doctor --gc-implement-checkpoints` reaps stale checkpoints per the 24h TTL. The worked example verifies cleanly under `dusk verify`. Detection-rate baselines established and documented.

---

### Sprint 10 — Real-world validation + ecosystem hooks

**Goal.** Apply Dusk to itself. Validate operational viability. Seed ecosystem.

**What gets built.**

**Self-application (dogfooding).** Pick a real package in dusk (suggested order: `packages/shared` first because it's a pure leaf, then `packages/api` for cross-cutting intents, then `packages/web` for UI conventions).
- Author intents for the package via `dusk_author` (use the 5-stage flow against real code).
- Decorate the package's existing code per the v9 model. The PreToolUse gate ensures every statement is decorated as code is touched.
- Run `dusk_implement` for small feature requests against the decorated package.
- Run `/dusk-doctor` periodically across the dogfood scope.
- Run for ≥ 2 weeks of real adoption time.

**Operational data collected:**
- Pipeline runs: count, average duration, average cost.
- Engineer iteration count distribution per bead.
- Verifier accept rate per intent.
- Long-cycle regression rate (% of beads where Step 5 found a regression).
- Test execution: pass/fail/duration per layer, missing-tests bounce-back rate.
- Author flow: 5-stage completion rate, branching decision distribution (how often does the user pick each resolution path?).
- Conflict Resolver invocation rate + resolution-success rate.

**Adoption friction observations:**
- Where does the user get confused?
- Which sub-agent's prompts need clearer phrasing?
- Which skills need to be expanded with more examples?
- What ceremony vs. value perception emerges?

**Ecosystem skeletons (light touch — not full builds):**
- Registry skeleton (in `packages/api`): tRPC routes for canonical-intent search + download. Lets a project pull canonical intents from a shared registry instead of bundling them.
- Authoring dashboard skeleton (in `packages/web`): adherence view (per-intent hierarchical satisfaction), intent tree view (browse `.ia/intents/`), decoration coverage view (decorated vs undecorated declarations).
- Drift visualization (in `packages/web`): commits-over-time view of which intents are being touched, regression heatmap by intent.

**Sprint 10 done means.** Dusk operates on at least one real dusk package for ≥ 2 weeks. Operational data is collected per the list above. The first round of adoption-friction findings is documented and fed back into role prompts + skills. Ecosystem skeletons are routable / renderable but not feature-complete (full ecosystem build is post-v1).

---

## Post-v1 — Sprint 11: Greenfield POC (the first v1.x change)

**Not part of the v1 gate.** Sprint 11 begins only after Sprint 10's dogfood gate passes and the Phase-5 OpenSpec change archives — v1 is landed first. It is specified here (and as **Phase 6** in the implementation plan, which carries the full behavioral-test contract P6-T1..T8) because its shape was settled during the v1 build and it is the natural first v1.x milestone.

**Goal.** Validate the v9 thesis in its pure form on Dusk's native terrain: a small but real **API application built greenfield, with zero hand-written application code** — every line produced through `dusk_author` + `dusk_implement`, mechanically auditable via the commit-trailer record.

**Why this is the right first v1.x move.** v9 is greenfield-first by design — decorate-at-authorship is the native mode; legacy bootstrap (RFC §8.2) is deferred precisely because retro-decoration is the *un*-native mode. Yet v1 never tests the native mode purely: Sprint 10's dogfood is brownfield-lite on a pure-leaf package (no DB, no HTTP, unit-only pyramid). Sprint 11 closes the three residual gaps in one artifact: the zero-hand-written-code thesis, the full test pyramid (integration vs live Postgres + e2e vs real HTTP) on real non-fixture code, and greenfield intent-tree authoring at application scale with Stage-2 tension detection operating as the tree grows.

**What gets built.**
- A fresh standalone repository (its own git history, purely Dusk-authored and independently auditable — not a monorepo package), `dusk init` from zero.
- A minimal **notifications API** on Dusk's own stack (TS strict ESM, Express + tRPC, Drizzle + Postgres, Vitest) — deliberately the canonical-intents / App. B domain so the Author's Stage-2/3 machinery operates on familiar ground: 4–6 endpoints, a cursor-paginated list, an idempotent write under a `compose: implies` intent, structured-logging + error-handling cross-cutting intents, full pyramid with integration + e2e children.
- A **trailer-audit script** (zero-model pass over `git log`) proving every application-source commit carries the full v9 trailer set — the mechanical form of the zero-hand-written-code constraint.
- A **`PocReport`** (the `DogfoodReport` shape reused) separating hard gates from exploratory greenfield-friction data (dialog turn counts, Stage-3 acceptance rates, intent-granularity stats, time-to-endpoint) that seeds the v1.x backlog.

**Human-input whitelist (the constraint's boundary):** authoring-dialog responses, `dusk_implement` requests, `dusk_resolve_livelock` / recovery resolutions, commit review/merge approval. Nothing else.

**Sprint 11 done means.** The smoke scenario "from `git init` to a working API, hands off the code" is green: intent tree 100% dialog-authored (incl. ≥1 `polarity: negative`, ≥1 closed-vocabulary `implies`, integration + e2e pyramid children); all endpoints landed via `dusk_implement` (≥1 multi-bead file-overlap run + ≥1 natural pause→author→resume among them); the app boots and its full pyramid is green against live infrastructure; the trailer audit passes; `dusk doctor --static-analysis` is clean in both modes on the born-decorated code; the `PocReport` gates pass and its friction data is fed back into role prompts/skills as reviewed commits. The POC repo stands as the canonical greenfield reference for v1.x adopters.

**Delivery model.** One OpenSpec change (`phase-6-greenfield-poc`), scaffolded after the Phase-5 change archives, per the same per-phase discipline. It requires **no deferred v1.x feature** — greenfield needs no legacy bootstrap, no vector search, no canonical-library runtime fetch.

---

## Dependency graph + parallelism map

```
                  ┌──────────┐
                  │ Sprint 1 │  schema + parser + graph + index core + canonical intents (first wave)
                  └────┬─────┘
                       │
                  ┌────▼─────┐
                  │ Sprint 2 │  decoration parser + index complete + PreToolUse gate
                  └────┬─────┘
                       │
            ┌──────────┴──────────┐
            │                     │
       ┌────▼─────┐           ┌───▼──────┐
       │ Sprint 3 │  role     │ Sprint 4 │  MCP server + Verifier procedure + dusk_inspect/verify
       │          │  files +  │          │
       │          │  memory + │          │       (Sprint 4 depends on Sprint 2; runs in parallel
       │          │  skills + │          │        with Sprint 3 because no runtime collision)
       │          │  tools    │          │
       └────┬─────┘           └────┬─────┘
            │                      │
            └──────────┬───────────┘
                       │
                  ┌────▼─────┐
                  │ Sprint 5 │  Decomposer + Bead Orchestrator + worktrees + short cycle (Steps 1-4)
                  └────┬─────┘
                       │
            ┌──────────┴──────────┐
            │                     │
       ┌────▼─────┐           ┌───▼──────┐
       │ Sprint 6 │  long     │ Sprint 8 │  Author + 5-stage flow + dusk_author
       │          │  cycle +  │          │
       │          │  test     │          │       (Sprint 8 parallel with 6-7; integration
       │          │  pyramid +│          │        point is Decomposer's escalation hook)
       │          │  Test     │          │
       │          │  Runner   │          │
       │          │ (Steps    │          │
       │          │  5-6)     │          │
       └────┬─────┘           │          │
            │                 │          │
       ┌────▼─────┐           │          │
       │ Sprint 7 │  commit + │          │
       │          │  merge +  │          │
       │          │  Conflict │          │
       │          │  Resolver │          │
       │          │  (Steps   │          │
       │          │  7-9)     │          │
       └────┬─────┘           └────┬─────┘
            │                      │
            └──────────┬───────────┘
                       │
                  ┌────▼─────┐
                  │ Sprint 9 │  observability + benchmark + doctor + worked example
                  └────┬─────┘
                       │
                  ┌────▼─────┐
                  │ Sprint 10│  real-world validation + ecosystem skeletons
                  └──────────┘
```

**Critical path:** 1 → 2 → 4 → 5 → 6 → 7 → 9 → 10. Eight sprints sequential.

**Parallelizable pairs (when authoring with multiple AI agents in parallel):**
- Sprint 3 ‖ Sprint 4 (different code paths, both gated on Sprint 2)
- Sprint 8 ‖ Sprints 6-7 (different runtime modules, integration point pre-stubbed in Sprint 5)

**Why these are the right cuts:**
- Substrate must come first (1 → 2). No runtime can be built without the index and the gate.
- The runtime split (3 ‖ 4) is clean because the role files (3) are file artifacts and the MCP read path (4) is wire-protocol code — they only intersect at the Verifier spawn point in Sprint 4, which can be temporarily stubbed.
- The pipeline split (5 → 6 → 7) is sequential because each step's exit gates the next.
- Authoring (8) is a sibling system to the pipeline (`dusk_author` is a separate MCP tool from `dusk_implement`); the cross-link is the Decomposer escalation hook, which is a one-line invocation.
- Validation (9) needs everything done before it can measure things meaningfully.
- Real-world (10) is final — for v1. Sprint 11 (the Greenfield POC) sits strictly after it, outside the v1 critical path: it begins only once the Phase-5 change archives.

---

## Validation checkpoints

| Sprint | Proven |
|---|---|
| 1 | Intent schema expresses real patterns. Path-to-id rule enforced. Graph traversal correct (upward/downward, cycle detection). First 6 canonical intents parse and inspect. `dusk init/validate/inspect` work. |
| 2 | All 6 decoration markers parse to structured records. Derived index supports forward/reverse/focal+support/test-discovery queries. All 10 PreToolUse checks fire on synthetic violations. `dusk doctor` (initial) catches every check. |
| 3 | All 9 role files spawn with correct memory + tool scope + skill set. Verifier confirmed memory: none. Engineer's bead memory persists across simulated iterations. Skills scoped per role (no cross-role leakage). |
| 4 | Verifier procedure produces correct per-triple verdicts on the worked example. `dusk_inspect` returns correct hierarchical satisfaction. `dusk_verify` works ad-hoc. Verifier's input is scoped (focal + support only, not full body). |
| 5 | `dusk_implement` runs Steps 1-4 end-to-end on a small request. Decomposer correctly walks parents/adjacents/test-children. Bead DAG topologically correct. Parallel/serial decision correct. Short cycle converges or hits 20-iter cap with escalation. Gate-fail and Verifier-reject loopbacks work. |
| 6 | Long-cycle universe computation correct for direct ∪ adjacent. N=10 rounds with fresh Verifier each + N=2 confirmation pass on first reject (mechanism tested via the scripted-verdict Verifier double). Test Runner discovers test files via index + invokes vitest with scoped file list. TestVerdict computed from runner output. Missing-tests and failing-tests both re-enter Step 4. |
| 7 | Full 9-step pipeline produces one commit per bead with all trailers. Parallel beads merge in topological order. Conflict Resolver resolves decorator conflicts. Return summary has all required fields. |
| 8 | `dusk_author` runs the 5-stage flow for a fresh intent. All branching decisions (classify, user-response, accept-or-defer) surface to user. Stage 5 commits atomically. Decomposer resumes correctly after authoring. Tested against a real intent-creation scenario in a dusk package. |
| 9 | Trace stream emits one event per sub-agent call. `/dusk-benchmark` produces per-model accuracy data on seeded-violations fixture. `/dusk-doctor` clean on a clean repo. Worked example verifies cleanly. Detection-rate baselines documented. |
| 10 | Dusk operates on ≥1 real dusk package for ≥2 weeks. Operational data collected per the Sprint 10 list. Adoption-friction findings fed back into role prompts + skills. Ecosystem skeletons routable. |
| 11 *(post-v1)* | The v9 thesis holds purely: an API application built from `git init` with zero hand-written application code (trailer-audited). Full test pyramid green against live Postgres + real HTTP on non-fixture code. Intent tree 100% dialog-authored. Born-decorated code shows zero erosion under `--static-analysis`. `PocReport` gates pass; friction data seeds the v1.x backlog. |

---

## What's deferred to v1.x

These are intentional cuts. The proposal calls them out in Ch. 8; the roadmap doesn't pretend they're v1 work.

**v1.x sequencing note:** the first v1.x change is already specified — the **Greenfield POC** (Sprint 11 above; Phase 6 in the implementation plan). It requires none of the items on this list; in particular it does NOT pull legacy bootstrap forward — greenfield is v9's native mode and needs no retro-decoration machinery. Everything below remains demand-triggered, with the POC's exploratory friction data as the primary prioritization input.

- ~~**Decorate-or-decompose static-analysis gating.**~~ **REPROMOTED to Sprint 9.** Framed as drift detection (decoration erosion over time), not real-time enforcement. `/dusk-doctor --static-analysis` ships in v1. (RFC §4.6, §8.9.)
- **Semantic / vector / RAG search for Author Stage 2.** v1 ships agent-driven grep over `.ia/intents/`. Embedding-based discovery is v1.x, triggered by reports of recurring missed tensions in Stage 2. (RFC §8.10.)
- **Runtime-fetched canonical intent library.** v1 ships none. Curated, importable intent libraries belong to the registry ecosystem (Sprint 10+) and v1.x. The `packages/intents/canonical/` directory in v1 contains documentation examples only. (RFC §8.11.)
- **Noun-phrase-shared universe expansion in Long Cycle.** v1 universe is direct ∪ adjacent. The noun-phrase-shared set is v1.x. (RFC §6.5.)
- **Heterogeneous models per role.** All roles use one model tier in v1. Benchmark data from Sprint 9 will tell us if there's value in role-specific models.
- ~~**Cross-bead claim overlap detection.**~~ **REPROMOTED to Sprint 5.** Moved from project-wide post-hoc check to Decomposer-time precondition. Decomposer refuses bead DAGs that would produce conflicting focal claims. (RFC §8.9.)
- **Per-intent claim minimum.** "Every intent has at least one focal claimant" is a project-wide check — v1.x. (RFC §8.9.)
- **Tool-scope hard sandboxing.** v1 ships advisory tool scoping (role-frontmatter `tools:` is configuration, not a sandbox). Hard sandboxing requires either Dusk-owned sub-agent runtime (Anthropic SDK + child processes) or a Claude Code primitive that doesn't exist yet. v1.x. (RFC §9.4.)
- **Skill scope hard enforcement.** v1 ships advisory skill organization (role prompt instructs which skills to load). Hard scoping requires harness-level discovery scoping. v1.x. (RFC §9.7.)
- **CLAUDE.md binding instruction hard enforcement.** v1's CLAUDE.md is advisory — the user can write code outside `dusk_implement` and the gate still enforces decoration mechanically, but the pipeline guarantees (regression detection, test execution) don't apply. v1.x may add a workspace marker that the gate uses to require pipeline-origin for some classes of writes. (RFC §10.1.)
- **Engineer ⊥ Verifier asymmetry full hardening.** v1 measures the asymmetry via the fresh-Verifier audit (Sprint 9). If variance proves correlated, v1.x adds heterogeneous models per role + structural reviewer diversity. (RFC §7.5.)
- **Legacy codebase bootstrap.** v1 assumes decorate-at-authorship. One-shot decoration of >20kLOC existing code is a deferred guided workflow.
- **Exhaustive verification mode.** Long-cycle uses shuffle sampling. Per-intent `verification: exhaustive` is v1.1.
- **Multi-language decoration.** Sprint 2 ships TypeScript decoration. Python / Go / Rust / SQL extensions are deferred (extension hooks designed but not wired).
- **Multi-framework coexistence.** Dusk owns the project's orchestration. Coexistence stories belong to v1.x or v2.
- **Long-running Orchestrator → state-machine split.** v1 is a single long-running stateful Root Orchestrator. The 9-step pipeline maps cleanly to a state-machine; that's an implementation refactor for v1.x, not an architectural change.
- **Heterogeneous test runners in polyglot monorepos.** v1 ships single-runner (vitest in this repo). Multi-runner support is v1.x.
- **Curated vocabulary SSoT.** Triples carry NL content; recurring noun phrases are derivable via `dusk_inspect`. A curated vocabulary file is v1.x with enforcement (triples constrained to vocab terms), not optional.

---

## Construction notes for parallel AI-agent assembly

These are not roadmap entries — they're operational hints for the assembly process itself.

1. **Each sprint's artifacts are independently shippable.** Sprint 1 ships even if Sprint 2 hasn't started. Use this — open a branch per sprint, land each through normal review, and let Phase 1 sprints land before Phase 2 starts.

2. **Role files (Sprint 3) are the highest-leverage early artifact.** Every later sprint that spawns sub-agents needs the role file to exist with correct frontmatter. Author all 9 role files early (in parallel with Sprint 1-2 if possible — they're pure file artifacts with no runtime dependency).

3. **Skills (Sprint 3) ship as a baseline. Improve them iteratively in Sprints 5-9.** The Sprint 3 skill files are the "shipped baseline" — they teach the role its core procedure. Sprint 9's dogfooding will surface gaps to fill in skill content.

4. **MCP server scaffolding (Sprint 4) can start before Sprint 3 finishes.** The MCP protocol layer is independent of the role runtime. Stub the role-spawn calls; fill them in once Sprint 3 lands.

5. **Sprint 5's Decomposer escalation point is a stub.** Sprint 5 ships with Decomposer escalating to the user on "missing intent." Sprint 8 replaces that stub with the `dusk_author` invocation. Don't conflate the two.

6. **Sprint 6's vitest integration is the only place test-runner specifics leak in.** Keep `packages/runtime/test-runner` clean of vitest specifics — the `dusk.config.yml` `test_runner.command` and `scope_args` are the only places the runner is named. This preserves the v1.x polyglot extension path.

7. **Sprint 9's seeded-violations fixture is the lasting deliverable.** It's not just a benchmark — it's regression testing for the entire pipeline going forward. Treat it as production-quality from the start.

8. **Sprint 10 is the only place the existing dusk app packages are touched.** Phase 1-4 work entirely in new packages (`core`, `delivery`, `runtime`, `intents`, `fixtures`, `cli`). The existing `api`, `web`, `hooks`, `shared`, `mobile` packages stay untouched until dogfooding starts.

9. **The Verifier prompt template is the single highest-leverage prompt.** Ship it complete (with few-shot examples from RFC App. B) in Sprint 3, NOT as a stub. Every later sprint depends on Verifier behavior being predictable. The same skeleton produces the other 8 role prompts.

10. **Sprint 9's `/dusk-doctor --static-analysis` is what makes v9 falsifiable.** Without it, decoration erosion is silent. Without the fresh-Verifier audit, the Engineer ⊥ Verifier asymmetry is unproven. Both are non-negotiable v1 deliverables — they convert architectural claims into measurable properties.

11. **Sprint 5's Decomposer is where the typed `relates_to` semantics earn their keep.** The check that refuses bead DAGs with conflicting focal claims (REPROMOTED from v1.x) cannot work without typed edges. Test the typed-edge semantics on a contrived fixture (intent A `conflicts` intent B, both in active set) before declaring Sprint 5 done.

12. **The v8→v9 schema migration is automatic.** Sprint 1's loader reads `schema_version: 1` intents, parses flat-list `relates_to` as `kind: sibling` (with deprecation warning), maps early-v9 `kind: refines` → `kind: parent`, and migrates triples with `negated: true` → `polarity: negative`. Existing v8 corpora migrate cleanly without authoring intervention.

---

## Reviewer feedback applied (architecture review board)

This roadmap incorporates feedback from THREE board rounds. Each row names the convergent risk + which round resolved it.

### Round 1 + 2 — initial architecture concerns

| Risk | Reviewers | v9 response |
|---|---|---|
| Engineer ⊥ Verifier asymmetry is structurally fragile | Architecture + LLM/AI | Structured bead memory format (§9.6.1) + fresh-Verifier audit benchmark (§7.5) |
| Decoration erosion silently degrades over time | Architecture + Constraint Lang + LLM/AI | `/dusk-doctor --static-analysis` REPROMOTED from v1.x to Sprint 9 |
| Claude Code integration claims don't match reality | CLI/MCP | Sub-agent spawn via Task tool (§9.9), advisory tool/skill scoping (§9.4, §9.7), harness contract reduced 5→4 (§10.3) |
| N=3 shuffle samples insufficient | LLM/AI | N=10 (§6.5) |
| Two parallel beads racing on same file | Architecture | File-overlap edges in Decomposer DAG (§6.2) + cross-bead claim overlap check REPROMOTED from v1.x to Sprint 5 (§8.9) |
| `dusk_author` MCP shape can't drive multi-turn | CLI/MCP | Continuation pattern (§10.1) |
| 20-iter cap thrashes without learning signal | LLM/AI | Iter-5 forced convergence diagnosis + iter-15 early escalation (§6.4) |
| `relates_to` semantically undefined | Constraint Lang | Typed edges (§2.1) |
| No conditional rules ("if X then Y") | Constraint Lang | `compose: implies` with antecedent/consequent (§3.2) |
| No quantifier vocabulary on triples | Constraint Lang | `quantifier:` field + optional `scope:` (§3.1) |
| Test-pyramid satisfies "tests exist" but not "behavior verified" | Architecture | Two-stage test-intent satisfaction (§3.4) |
| No `dusk_cancel`, no MCP resources, no error envelopes, no trace schema_version | CLI/MCP | All added |
| Test-pyramid suffixes too rigid | Constraint Lang | Configurable via `dusk.config.yml` (§3.4) |

### Round 3 — refinements that surfaced after Round 2 edits

| Risk | Reviewers | v9 response |
|---|---|---|
| Engineer's iter-5 diagnosis was leaking into Verifier spawn payload, breaking the asymmetry the audit validates | LLM/AI | Diagnosis is Bead-Orchestrator-only; Verifier spawn payload is identical across iterations. (§6.4, §9.6.1) |
| `compose: implies` antecedent semantics were undefined (LLM-judged would create silent-under-firing on `must` rules) | LLM/AI + Constraint Lang | Closed antecedent vocabulary, deterministic index-lookup evaluation, no LLM call. (§3.2.1) |
| Affirmative-only enforcement compounded into a parser lexicon arms-race; App. B violated its own parser | Constraint Lang | **Polarity model** (§3.1) — `polarity: positive \| negative` field; slots stay affirmative; runtime inverts the verdict post-LLM. The LLM never sees negation. + AST-aware matrix/constituent parser (§3.1.1) — allows constituent negation inside NPs. |
| Verifier per-triple verdict conflated focal-code correctness with support-triple quality — Engineer couldn't distinguish "fix code" from "fix docstring" | LLM/AI | Verdict split into `focal_verdict` (drives re-draft) + `support_quality` (advisory). (§3.3, App. A.4) |
| Support claims had no formal verdict slot ("documentation or assertion?" ambiguous) | Constraint Lang | Per-claim `triple_verdict: matches \| mismatch \| vague` (App. A.4) |
| Derived index unspecified under parallel worktrees | Architecture | **Session-snapshot + per-bead delta** (§2.10). Snapshot immutable for the run, identified by `index_snapshot_id`. |
| No per-bead total iteration cap across Step 4↔5↔6 loopbacks (only per-Step-4 ceiling) | Architecture | **40-iter lifetime budget + 4-level recovery ladder** (§6.4.1). Level 1 partial commit → Level 2 intent-modification proposal → Level 3 freeze → Level 4 abort. |
| Long-cycle sequential early-stop on a single Verifier reject = false-positive amplification | LLM/AI | **N=2 confirmation pass on first reject** (§6.5). ≥1/2 confirm → regression; both override → flaky verdict dismissed. |
| `dusk_implement` ↔ `dusk_author` interleaving was hand-waved — MCP can't block across multi-turn dialogs | CLI/MCP | **Disk-checkpoint resume contract** (§10.1.1). Decomposer-pause returns `DuskError{kind: "implement_paused_for_authoring", details.resume_token}`; harness drives dialog; resume via `dusk_implement({resume_token})`. |
| `dusk init` settings.json merge strategy unspecified — silent footgun for projects with existing hooks | CLI/MCP | **`_dusk_marker` idempotency anchor + conflict-prompting three options** (§4.6.1). Never silent clobber. |
| MCP resources may be dead surface on Claude Code today | CLI/MCP | **Paired read-only fallback tools** for every resource URI (§10.1). |
| `dusk_cancel` semantics sketched, not specified | CLI/MCP | **Cooperative-cancellation contract** (§10.1.2). Drain in-flight Task calls; ordered cleanup; `CancelResult` distinguishes `cancelled[]` from `preserved[]`. |
| Iter-5 hard threshold ignored already-collected verdict-delta data | LLM/AI | **Stuckness detector** (§6.4.2) — three-iter sliding window over `verdict_delta_from_prior` + stable failing-triple set. Fires diagnosis as early as iter 3; iter-5 ceiling preserved as fallback. |
| Fresh-Verifier audit (variance + similarity) couldn't distinguish deterministic correctness from rubber-stamp correlation | LLM/AI | **Citation precision as third axis** (§7.5.1). Structural parse of `file:line` vs seeded `ground_truth_defect_loc`. No LLM-judge. High-similarity × Low-precision = rubber-stamp signature. |
| Test-Verifier livelock surfaced as opaque "tests failed convergence" | Architecture + LLM/AI | **`TestVerifierLivelockReport` + `dusk_resolve_livelock`** (§3.4.1). 3-condition detector; user resolves via `accept_test_as_is` / `modify_triple` / `escalate`. |
| `parent` vs `refines` `relates_to` kinds would be conflated by authors | Constraint Lang | **Collapsed to single `parent` kind** (5 typed kinds remain). Path hierarchy expresses narrowing. |
| Affirmative-only lexicon was incomplete (`fails to`, `excludes`, `lacks`, …) | LLM/AI + Constraint Lang | Lexicon expansion → 18 markers. Combined with the polarity model and matrix/constituent rule, the lexicon catches author errors (write `polarity: negative` instead) without forcing awkward circumlocutions. |

### Round 4 — implementation-plan board review (applied to the v9 implementation plan + this roadmap + the proposal)

A five-member board (Lead Architect, Principal Engineer, Lead AI/LLM Engineer, Lead Constraint-Language Engineer, Martin Fowler) reviewed the per-phase implementation plan; all five returned Approve-with-changes. Resolutions span all three docs. Scaling guidance: **v1 is not built to scale** — it leans on frontier-model determinism and optimizes the substrate during efficacy testing, so the board's "scale-ready CI" recommendation is applied only as a pragmatic posture.

| Risk | Reviewers | Round-4 response |
|---|---|---|
| Freshness asserted "byte-identical spawn payload" against a lossy `input_summary` — too strong (breaks on reordering) and too weak (identical payloads still correlate) | Fowler + LLM/AI | **Test-mode `raw_prompt` capture** (App. A.6); freshness reframed to **structural no-leak** + the §7.5 audit. (App. D.22) |
| Recovery Ladder split (Sprint 5 L1+L4 / Sprint 9 L2+L3) shipped a contract where a zero-satisfiable bead hard-aborted (`recoverable:false`) vs RFC's `bead_intent_revision_needed` (`recoverable:true`) | Architecture + Principal Eng | **All four levels moved to Sprint 5.** Sprint 9 no longer implements recovery; Sprint 8 wires only L2's author-driven recovery action. |
| No model-nondeterminism policy; tests written as if single-shot LLM asserts are stable; CI not runnable as written | Principal Eng + LLM/AI | **Frontier-tier default + `temperature: 0`** (§7.1, App. D.21); **scripted-verdict Verifier double + injectable clock** for control-flow tests; pragmatic (not scale-ready) CI. (Test & determinism posture section.) |
| Confirmation-pass / flake / budget / livelock tests can't be made deterministic against a real model | Principal Eng + LLM/AI | Mechanism tested via the Verifier double; real-model flake *rate* characterized non-gating in Sprint 9. |
| `compose: implies` antecedents: only 1 of 3 predicates tested; no set-complement; no no-LLM-fallback test | Constraint Lang | Added plan tests P2-T6b/c, P2-T7b (all 3 predicates + negative-polarity antecedent + ambiguous→structural-error, zero LLM calls). |
| Quantifier `≤`/`none` family + `scope` binding untested; gate test conflated 10 checks with 12 rejection kinds | Constraint Lang | Plan tests for the full quantifier family + `scope`; **gate test re-pivoted to one fixture per rejection kind**; RFC §4.6/A.8 state the 10→12 mapping. |
| The verdict split's loop consequence (low-confidence ≠ re-draft) was tested nowhere | Fowler (contrarian) | Added plan test P3-T29; the audit's pass bars are now **pre-registered** with numeric bars on all three axes (N≥10). |

Two RFC doc defects corrected in passing: the stale App. C row claiming the diagnosis "flows into Verifier spawn payloads on iter ≥ 6", and the 10-checks-vs-12-rejection-kinds count drift (also `9 checks` → `10 checks` references reconciled).

---

## Closing

This roadmap commits to **v9's architecture without hedging**. The build sequence reflects what v9 actually requires: substrate first, runtime second, pipeline third, authoring fourth, validation fifth. The parallelism cuts are real and small in number — most of the work is genuinely sequential because each layer depends on the layers beneath it.

The pieces that v4 spent effort on but v9 no longer needs (blocks, composition engine, source-map pipeline, triage, adherence DB) are gone from the build. The pieces v9 introduces (decoration substrate, 9 role files, memory materialization, skill scaffolding, 9-step pipeline, test pyramid via reserved suffixes, Conflict Resolver, Author 5-stage flow) are the new center of gravity.

**The pieces the architecture review board's three rounds of feedback added** convert architectural claims into measurable properties:

- **Polarity model + matrix/constituent parser** — structural negation, not lexicon games.
- **Closed-vocabulary deterministic antecedents** — `compose: implies` antecedents are facts, consequents are judgments.
- **Session-snapshot + bead-delta index** — deterministic cross-bead reads under parallel worktrees.
- **40-iter lifetime budget + 4-level recovery ladder** — bounded retry across Steps 4↔5↔6 with graceful exits.
- **Stuckness detector + iter-5 fallback** — early diagnosis from already-collected data.
- **N=2 long-cycle confirmation pass** — Verifier variance noise filtered out of regression detection.
- **Three-axis fresh-Verifier audit** — variance + similarity + citation precision distinguishes correlated correctness from rubber-stamp bias.
- **Test-Verifier livelock detection + resolution UX** — opaque "test failed convergence" replaced with structured payload + three resolution verbs.
- **Dual-channel bead memory + diagnosis-routing** — Engineer's diagnosis informs orchestrator routing but never enters Verifier spawn payload.
- **Disk-checkpoint pause/resume contract** — `dusk_implement` pauses across `dusk_author` dialogs without blocking MCP requests.
- **Cooperative cancellation** — honest about Claude Code's Task-tool abort surface.
- **`_dusk_marker` settings.json merge + check-hook --repair** — idempotent installation, never silent clobber.
- **MCP resources + paired fallback tools** — works on hosts with or without resource browsing.
- **Per-claim support verdicts + verdict split** — Engineer gets unambiguous repair signal.

The honest framings the review board's feedback forced (advisory tool/skill scoping, advisory CLAUDE.md binding, harness contract reduced to 4 real capabilities, sub-agent spawn via Claude Code's Task tool, cooperative cancellation, disk-checkpoint pause/resume, paired resource fallbacks) reflect the actual capability surface available in v1 — not an idealized harness that doesn't exist yet.

Post-v1, the first milestone is fixed: **Sprint 11's Greenfield POC** — an API application built from `git init` with zero hand-written code, proving the thesis on the terrain v9 was designed for. Its friction data, not speculation, prioritizes the rest of v1.x.

Build for right. Land the plane.
