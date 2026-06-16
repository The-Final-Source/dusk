# Intent Architecture — Proposal v9 (Decoration Model · Code Style · Test Pyramid · Sub-Agent Memory & Skills)

| | |
|---|---|
| **Supersedes** | [v8](./intent-architecture-proposal-v8.md) |
| **Author** | Spencer Marx |
| **Date** | 2026-05-26 |
| **Status** | Draft |

---

## Preamble

v8 collapsed intent and constraint into one concept, defined eight sub-agent roles, and made Dusk the implementation framework. What it left underdetermined was **how decoration works for code that isn't a declaration** — every function call, every for loop, every try block, every assignment was either implicitly covered by an enclosing declaration's `@intent` or invisible to the verifier.

v9 closes this gap and, in closing it, makes three further commitments visible that were latent in v8:

1. **The decoration model becomes total.** Every statement or block has explicit decoration. There is no "implicit coverage." Non-declaration code uses two markers — `@intent` when the statement focally achieves an intent's aspect, `@intent-support` when it contributes to one. `@intent-support` carries an inline natural-language triple `[subject, predicate, object]` describing what the statement does. The Verifier reads, per aspect, the focal claimant(s) plus their support claimants — scoped, not the whole body.

2. **Code style is an explicit architectural concern, not a stylistic preference.** Code is authored for AI consumption, not human reading. The Engineer sub-agent must structure code so each statement carries one clear semantic role: nested user-defined function calls are extracted, loop-invariant computations are hoisted, object construction is separated from its uses. Verbosity is free; decoration cleanliness is the binding constraint. The PreToolUse gate enforces structural rules in addition to decorator presence.

3. **Cross-cutting intents are decorated on the code that touches them.** A function using Drizzle declares `@intent db/use-drizzle-orm` at the function level *and* every Drizzle call site inside the function carries `@intent-support db/use-drizzle-orm`. Decoration follows touch. Directory-level `.intent` files are for genuinely directory-level invariants (e.g., "this directory contains only pure leaf code"), not for cross-cutting concerns.

Three further additions, each smaller but load-bearing:

4. **The test pyramid is encoded as child intent suffixes.** `<impl-intent>/unit-tests`, `<impl-intent>/integration-tests`, `<impl-intent>/e2e-tests` are reserved hierarchical paths. Code under these intents is marked with `@intent-test` (declaration) or `@intent-test-file` (file scope). A ninth sub-agent role — **Test Runner** — executes them in a new pipeline step (Step 6, between Verification and Authoring).

5. **Sub-agent memory is explicit per role.** Each role's frontmatter declares its memory scope. The Engineer is persistent per bead (memory: bead-scoped). The Verifier is fresh per call (memory: none) — this is now enforced via the role frontmatter, not implicit. Memory configuration is the structural mechanism behind the pair-programming asymmetry.

6. **Sub-agent skills scaffold per role.** Each role can register skills under `.claude/skills/dusk/<role>/<skill>.md`. Skills are role-bound — the Engineer's skills are different from the Verifier's, and a role cannot load a skill not registered to it. Skills are the extension point for domain-specific authoring patterns (e.g., a `dusk/engineer/drizzle-extraction.md` skill teaching the Engineer how to extract nested Drizzle predicates per the code-style rule).

The pipeline grows from 8 steps to 9 (Test Execution added). The role count grows from 8 to 9 (Test Runner added). The decoration syntax grows with `@intent-support`, `@intent-test`, `@intent-test-file`. Everything else carries forward from v8.

The conceptual frame is unchanged: Dusk is the implementation framework, AI agents are the sole authors, atomic hierarchical intents carry the truth. v9 makes the model **complete** — there is no longer a category of code the system is silent about.

**Read order:** Chapter 1 establishes the mental model with the updated pipeline and the decoration-completeness mandate. Chapter 2 covers artifacts. Chapter 3 the constraint language with the test pyramid extension. **Chapter 4 (new) defines the decoration model in full** — focal/support, inline triples, the decorate-or-decompose mandate. Chapter 5 the intent authoring sub-flow. Chapter 6 the 9-step implementation pipeline. Chapter 7 the Verifier model and observability. Chapter 8 deferred capabilities. Chapter 9 sub-agent architecture (now 9 roles with memory + skills). Chapter 10 the integration surface. **Appendix B (new) is the canonical worked example — `sendNotification` fully rewritten under the v9 decoration model.** Appendix C is the v8→v9 migration map.

---

## Chapter 1: The Mental Model

### 1.1 Dusk is the implementation framework

In a Dusk-governed project, Dusk owns the entire path from "user describes work" to "atomic commits on main." The agent harness — Claude Code or anything equivalent — receives the user message and routes code-authoring work to Dusk via MCP tool calls. Everything between the input and the output happens inside Dusk:

- Decomposing the user request into intent-aligned beads
- Sequencing beads (parallel where independent, serial where dependent)
- Creating git worktrees for parallel beads
- Spawning Engineer + Verifier sub-agent pairs per bead
- Running the shuffle-sharding regression check
- **Executing the test pyramid (new in v9)**
- Producing the atomic commit
- Merging worktrees back to main

The harness doesn't manage any of this. It manages the conversation with the user and integrates Dusk's output back into the session. This is a deliberate boundary — Dusk's correctness guarantees (pair bias resistance, regression detection, decorator gating, **decoration completeness**) require Dusk to own the orchestration. Delegating to the harness opens those guarantees to violation.

**One framework per project at v1.** Coexistence with other orchestration frameworks is deferred — out of scope until v1.x at the earliest.

### 1.2 The premise: AI is the sole author

AI agents are the sole authors of code. Humans architect via intent. Every design decision in v9 assumes this — decorator burden is irrelevant because agents emit decorators; bias resistance is structural because Dusk owns sub-agent spawning; the implementation pipeline is automatic because humans don't author code by hand.

**v9 makes this stance load-bearing in a new way: code style itself is shaped by AI consumption.** Humans don't read code anymore; Verifier sub-agents do. The decoration system is the primary readable surface. Code structure is rearranged to make decoration clean — nested function calls are extracted, intermediate values are named, control flow is flattened. The cost (visual verbosity) is paid by an audience that doesn't care; the benefit (per-statement verifiability with explicit semantic roles) accrues to the system's correctness guarantees.

This is not a stylistic preference. It is a structural requirement, enforced by the PreToolUse gate (Ch. 4.6).

### 1.3 Intents are atomic and hierarchical

An intent is an atomic unit. It has:

- A unique slash-namespaced **id** (the path).
- A prose **description**.
- An **obligation** (`must` / `should` / `may`).
- A **compose** rule (`all` / `any` / `none`) governing how its triples combine.
- A list of **triples** — each an affirmative `(subject, predicate, object)` assertion with optional `quantifier` + `scope`, carrying free natural-language content. (Negation is rephrased affirmatively at authoring time; see §3.1.)
- Optional `relates_to` linkages to other intents (typically a parent, sometimes siblings).

There is no inner "constraint" layer. The intent *is* the assertion.

**Hierarchy via path.** An intent's id can be any depth:

- `api/pagination` — broad
- `api/pagination/cursor-only` — refines
- `api/pagination/cursor-only/cursor-decode` — specific

**Reserved test pyramid suffixes (new in v9):** Any intent `X` can have child intents at the reserved paths `X/unit-tests`, `X/integration-tests`, `X/e2e-tests`. These are normal child intents in every other respect — their satisfaction rolls up to `X` per hierarchical satisfaction. The reservation is by convention; the Test Runner sub-agent (Ch. 9) discovers test code via decorators referencing these intents.

**Hierarchical satisfaction.** A leaf intent is satisfied when its triples pass (per its compose rule). A parent intent is satisfied when (a) its own triples pass *and* (b) every direct child intent is satisfied.

### 1.4 Decorators link code to intents (the v9 model)

Decoration is the link between code and intents. In v9 the decoration model is **total**: every statement or block carries explicit decoration. There is no implicit coverage from an enclosing declaration.

Four decorator types govern code:

| Marker | Applies to | Role |
|---|---|---|
| `@intent` | declarations, AND non-declaration statements/blocks that focally achieve an intent aspect | Focal claim — "this is what makes the aspect hold" |
| `@intent-support` | non-declaration statements/blocks that contribute to an intent aspect | Supporting claim — "this contributes to the aspect, with the described role" |
| `@intent-test` | test declarations (functions, suites) | Test claim — "this declaration tests the named intent's aspect" |
| `@intent-ignore` | declarations / files / directories | Opt-out — "this code is exempt from the named intent, with a structured reason" |

Two more cover scope:

| Marker | Applies to | Role |
|---|---|---|
| `@intent-file` | top of a file | File-scoped focal claim |
| `@intent-test-file` | top of a test file | File-scoped test claim |

The `@intent-support` marker carries an inline NL triple:

```typescript
// @intent-support sync/pubsub-on-create [event-per-insert] ["the publish call", "delivers", "the prepared event onto the sync channel via pubsub"]
await pubsub.publish(channel, event);
```

The triple `[subject, predicate, object]` documents what this statement does — its structural role in supporting the named aspect. This documentation is **for the Verifier**, not for humans. It is verbose by design.

The full decoration model — focal vs support, cross-cutting intents, the decorate-or-decompose mandate, the PreToolUse extension — is Chapter 4. The remainder of this chapter establishes the surrounding context.

### 1.5 The decoration-completeness mandate

A core v9 commitment, stated as a single hard rule:

> **Every line, call, assignment, statement, expression, and lambda body — and their contents — must be covered by intent decorators appropriate to their participation. When a code unit's contents include operations whose intent participation differs from the unit's decoration, the unit is decomposed so each sub-operation can be decorated appropriately.**

This is the only structural rule. There is no per-syntax-feature table, no "method chains exempt, nested calls extract" cookbook — because the right call depends on *intent participation*, not on syntactic shape. The same chain expression decomposes when its steps touch different intents and stays whole when they share an intent footprint.

The Engineer sub-agent (Ch. 9) authors code to satisfy the mandate proactively. The PreToolUse gate (Ch. 4.6) enforces it mechanically per write. Full mandate, examples, and rejection semantics in Ch. 4.5.

### 1.6 The nine-step implementation pipeline

When the harness invokes `dusk_implement(request)`:

```
1. Request decomposition
   (Decomposer parses the request against the intent index)

2. Bead decomposition + sequencing
   (each intent touched = one bead; dependency DAG produced)

3. Worktree creation
   (parallel beads get separate git worktrees; serial beads run in-place)

4. Per-bead short cycle — pair programming
   (Engineer + Verifier in isolated contexts, iterate until Verifier accepts)

5. Per-bead long cycle — shuffle sharding
   (3 random unique samples from the affected universe; regression → feedback to step 4)

6. Test execution                                                  [NEW in v9]
   (Test Runner spawns; runs unit + integration + e2e suites scoped
    to the bead's touched intents; failures → feedback to step 4)

7. Atomic commit
   (conventional commit + structured trailers naming intents, aspects, verdict)

8. Worktree merge (if parallel)
   (rebase worktree branches to main; Conflict Resolver if needed)

9. Return summary to harness
```

The pipeline is detailed in Chapter 6. The cycles inside it (pair, shuffle, test) are sub-procedures of Bead Orchestrator, not separate roles (with the exception of Test Runner, which is its own role for tool-scoping reasons — Ch. 9).

The full pipeline + sub-flow + sub-agent role graph is visualized in `docs/diagrams/dusk-master-flow-v2/`. Per-topic standalone diagrams: `dusk-full-flow-v5/` (pipeline only — needs update to v6 for Step 6 addition), `dusk-intent-creation-v2/` (authoring drill-down), `dusk-subagent-roles-v1/` (roles graph + tool scopes — needs update for Test Runner).

---

## Chapter 2: The Artifacts

### 2.1 Intent file — atomic, hierarchical, NL triples

```yaml
# .ia/intents/api/pagination/cursor-only/cursor-decode/intent.yaml
schema_version: 2
id: api/pagination/cursor-only/cursor-decode
description: |
  Cursor decoding validates input and produces a typed state.

obligation: must
compose: all

triples:
  - id: query-param
    subject: "the cursor decode function"
    predicate: "accept"
    object: "a single string query parameter named 'cursor'"
  - id: return-payload
    subject: "the cursor decode function"
    predicate: "return"
    object: "a typed CursorState or a typed DecodeError"
  - id: error-on-malformed
    subject: "the cursor decode function"
    predicate: "return"
    object: "a typed DecodeError on malformed input"

relates_to:
  - kind: parent
    target: api/pagination/cursor-only
```

**Schema notes:**

- `id` must equal the path from `.ia/intents/` to the file's directory.
- `triples[].id` is the *clause id* — what decorators reference in brackets. (Historically called "aspect"; renamed in v9 to avoid collision with the AOP sense of "aspect" used for cross-cutting intents.)
- `compose` defaults to `all` and accepts `all | any | none | implies`.
- `triples[]` carry an optional `polarity: positive | negative` field (default `positive`). The subject/predicate/object slots are always affirmative English; polarity inversion happens at the runtime layer, never in the prompt. See §3.1.
- Triples optionally carry a `quantifier` (default existential) and `scope` (free NL bound for the quantifier).

**`relates_to` is typed (NEW v9 — five kinds in v1).** Each entry is an object with `kind` and `target`. v9 ships **five kinds**; the earlier-drafted `refines` kind was collapsed into `parent` (the "narrowing" semantic is implicit in path hierarchy, and authors will conflate the two if both exist).

| Kind | Semantics | Decomposer / Verifier behavior |
|---|---|---|
| `parent` | This intent is a child of the target | Walk upward for satisfaction rollup; include parent in scope when descendant is touched |
| `implies` | Satisfying this intent requires also satisfying the target | Decomposer adds target to the active intent set whenever this intent is touched; antecedent evaluation is index-lookup-only per §3.2.1 |
| `conflicts` | This intent opposes the target — they should not both be claimed on the same code | Decomposer refuses to issue beads producing claims on both in one pipeline (§6.2); `/dusk-doctor` flags any code carrying both decorations |
| `supersedes` | This intent replaces a deprecated target | Decomposer treats the target as deprecated; gate warns on writes that reference the superseded path |
| `sibling` | Close concern in the hierarchy, no satisfaction dependency | Context-only; the Decomposer does not auto-expand scope |

Legacy v8 flat-list `relates_to` is read as `[{kind: sibling, target: <path>}]` on load (advisory bias toward sibling) with a deprecation warning. Early-v9-draft `kind: refines` entries load as `kind: parent` (strictly stronger behavior — `refines` differed from `parent` only by skipping Decomposer auto-expansion, which v9 retains).

### 2.2 Test pyramid intents — reserved suffixes

Any implementation intent can have child test intents at three reserved suffixes:

```
.ia/intents/api/pagination/cursor-only/cursor-decode/
├── intent.yaml                              # implementation intent
├── unit-tests/
│   └── intent.yaml                          # api/pagination/cursor-only/cursor-decode/unit-tests
├── integration-tests/
│   └── intent.yaml                          # api/pagination/cursor-only/cursor-decode/integration-tests
└── e2e-tests/
    └── intent.yaml                          # api/pagination/cursor-only/cursor-decode/e2e-tests
```

Each is a normal child intent. Their triples assert what good tests at that pyramid level look like for the parent. Example:

```yaml
# .ia/intents/api/pagination/cursor-only/cursor-decode/unit-tests/intent.yaml
schema_version: 1
id: api/pagination/cursor-only/cursor-decode/unit-tests
description: |
  Unit tests for cursor decoding cover the valid, malformed, and missing-cursor cases
  with no dependency on a running database, network, or HTTP server.

obligation: must
compose: all

triples:
  - id: covers-valid-decode
    subject: "the cursor decode unit-test suite"
    predicate: "include"
    object: "a passing case for a valid base64url-encoded cursor producing the expected CursorState"
  - id: covers-malformed
    subject: "the cursor decode unit-test suite"
    predicate: "include"
    object: "at least one case for each documented malformed-input class (bad base64, bad json shape, missing fields)"
  - id: isolated-from-infra
    subject: "the cursor decode unit-test suite"
    predicate: "runs in"
    object: "a sandboxed pure-function environment with no database connection, network call, or HTTP server fixture"

relates_to:
  - kind: parent
    target: api/pagination/cursor-only/cursor-decode
```

The Test Runner discovers test code by reading `@intent-test`/`@intent-test-file` decorators referencing such intents.

### 2.3 File layout — hierarchy on disk

```
.ia/intents/
├── api/
│   ├── pagination/
│   │   ├── intent.yaml                        # api/pagination
│   │   ├── cursor-only/
│   │   │   ├── intent.yaml                    # api/pagination/cursor-only
│   │   │   ├── cursor-decode/
│   │   │   │   ├── intent.yaml                # api/pagination/cursor-only/cursor-decode
│   │   │   │   ├── unit-tests/
│   │   │   │   │   └── intent.yaml            # …/cursor-decode/unit-tests
│   │   │   │   └── integration-tests/
│   │   │   │       └── intent.yaml            # …/cursor-decode/integration-tests
│   │   │   └── cursor-encode/
│   │   │       └── intent.yaml
│   │   └── page-size-bound/
│   │       └── intent.yaml
│   └── auth-required/
│       └── intent.yaml
└── ...
```

The directory structure mirrors the intent id. The runtime walks `.ia/intents/` recursively and resolves each `intent.yaml` to its hierarchical id from the path.

### 2.4 Decorators on declarations

```typescript
// @intent api/pagination/cursor-only/cursor-decode [query-param]
export function parseCursorString(raw: string): string { ... }

// @intent api/pagination/cursor-only/cursor-decode [return-payload, no-throws]
// @intent api/auth-required [authorization-required]
export async function listOrders(query: ListOrdersQuery): Promise<ListResponse> { ... }
```

Rules:
- One `@intent` per line.
- `<intent-path>` is the full hierarchical id.
- `[<aspect-id>, ...]` optional. Aspect ids must resolve to triple ids in that intent.
- Bracket omitted → claims all triples of the intent.

### 2.5 Decorators on non-declaration code (new in v9)

Non-declaration statements and blocks carry `@intent` (focal) or `@intent-support` (supporting). See Ch. 4 for the full model. Brief example:

```typescript
// @intent notifications/send [persist-first]
const inserted = await db.insert(notifications).values(rows).returning();

// @intent-support notifications/send [persist-first] ["the row builder", "constructs", "a notification row per target user from the payload"]
const rows = userIds.map((userId) => ({ userId, ...payload }));
```

`@intent-support` is followed by the intent id, the aspect-id array, and a NL triple array `[subject, predicate, object]` describing what the statement does.

### 2.6 Decorators on test code (new in v9)

```typescript
// @intent-test api/pagination/cursor-only/cursor-decode/unit-tests [covers-valid-decode]
test("decodes a valid base64url cursor to typed CursorState", () => { ... });

// @intent-test api/pagination/cursor-only/cursor-decode/unit-tests [covers-malformed]
test.each(MALFORMED_CASES)("rejects malformed cursor: %s", (input) => { ... });
```

File-scoped form:

```typescript
// @intent-test-file api/pagination/cursor-only/cursor-decode/unit-tests
import { describe, test, expect } from "vitest";
// ...
```

The Test Runner reads these decorators to discover which test code maps to which test-intent, scopes its runs per bead, and reports failures back through the pipeline.

### 2.7 File scope, directory scope

```typescript
// @intent-file nestjs/resource-module/sibling-convention [service, controller, repository, module]
@Injectable()
export class UserService { ... }
```

```
# packages/web/.intent
@intent web/no-api-runtime-imports
@intent web/route-naming-convention [filename-pattern, export-shape]
```

Same syntax rules as declaration decorators. One per line. Optional aspect list.

**Note (v9 clarification):** Directory-scoped `.intent` files are for **genuinely directory-level invariants** — properties that apply to the directory as a structural unit (e.g., "this directory contains only pure leaf code", "this directory's exports are the public API"). They are **not** the way to express cross-cutting concerns. Cross-cutting intents (e.g., `db/use-drizzle-orm`, `observability/structured-logging`) are decorated on each function that touches them, per Ch. 4.3.

### 2.8 Opt-out — `@intent-ignore`

```typescript
// @intent-ignore api/pagination/cursor-only/cursor-decode because=(this-file, is-generated-by, openapi-gen-cli) reason="Generated from OpenAPI spec; do not hand-edit."
export function listGeneratedReports() { ... }
```

Both `because=(...)` and `reason="..."` required. Same controlled ignore-predicate vocabulary as v8 (`is-generated-by`, `is-replaced-by`, `is-shimmed-for`, `is-deprecated-in`, `is-exempt-due-to`, `is-governed-by-external`).

### 2.9 Derived index

In-memory index built at session start by scanning files for all decoration markers:

```
(file, line, scope, declaration_name|null, marker, intent_path, aspect_ids[]|null, support_triple|null)
```

Where `marker` is one of `intent` / `intent-support` / `intent-test` / `intent-file` / `intent-test-file` / `intent-ignore`. The `support_triple` field is populated only for `intent-support` rows and carries the inline NL triple.

Forward query (`intent_path → claimants`), reverse query (`file → intents`), aspect-rollup query (`intent_path → unsatisfied aspect_ids`), **focal/support query (`(intent_path, aspect_id) → (focal_claimants[], support_claimants[])` — new in v9)**, and test-discovery query (`intent_path → test_decorators` — new in v9) all operate on this table. Not an artifact. Not committed. Regenerable.

### 2.10 Index coherency across parallel worktrees (NEW v9)

v9's pipeline runs parallel beads in git worktrees (§6.3). Each bead's Engineer writes decorations concurrently. The Decomposer's file-overlap edge construction (§6.2), the long-cycle universe computation (§6.5), the Verifier's claim resolution, and the cross-bead overlap check (§8.9) all need a coherent index. v9 commits to a **session-snapshot model** rather than a coordination protocol.

**The session snapshot.** At the start of each `dusk_implement` run, the Root Orchestrator computes the index by scanning the merge-base commit (typically `origin/main`). The result is the **session snapshot** — immutable for the run's lifetime, identified by a content hash carried on every SubAgentTrace event as `index_snapshot_id`. All cross-bead reads (Decomposer DAG construction, long-cycle universe, focal/support overlap checks) read the snapshot alone.

**The bead delta.** Each parallel bead additionally maintains a small in-memory delta — the decorations its Engineer has authored to the bead's worktree since the snapshot. The delta is visible only to that bead's own Engineer / Verifier / Test Runner / Bead Orchestrator. Bead deltas are never exposed to cross-bead queries.

**Operational rules.**

- Snapshot is built once at pipeline entry (Root's responsibility, before Decomposer Step 1). Hash is recorded on every trace event.
- Snapshot is immutable for the run; rebuilt only at the next top-level `dusk_implement` invocation. Pass `--rebuild-index` to force a rebuild within an existing session.
- Bead deltas update on commit-to-worktree (not on every successful gate pass — failed iterations don't pollute the delta).
- Verifier spawn payloads include `{snapshot_id, bead_delta_summary}`. Same-bead queries (Verifier reading the bead's own focal+support claimants for evaluation) see snapshot ∪ delta; cross-bead queries see snapshot only.
- The long-cycle universe (§6.5) explicitly reads the snapshot only — bead deltas are excluded by design; they are the diff under test, not the regression surface.
- At Step 8 rebase: if main's decoration set has drifted from the snapshot beyond the bead's own delta, a `snapshot_drift` event is emitted and the Conflict Resolver is invoked. `Partial: true` trailers from recovery-Level-1 commits (§6.4.1) are treated as authoritative additions, not drift.

**Why session-snapshot, not per-worktree or coordinated.** Per-worktree indices make the bead DAG non-deterministic — file-overlap edges depend on whichever bead happens to write first, defeating the cross-bead conflict check (§8.9). Coordination protocols introduce distributed-state liability incompatible with v1's "Dusk is a guest in the harness" stance. Session-snapshot mirrors `git rebase`'s discipline: every parallel branch reasons against the same base.

---

## Chapter 3: The Constraint Language

### 3.1 Triples — structural decomposition, NL content

Each intent's assertions are expressed as triples. The structure (three labelled slots) is what gives the Verifier a narrower question per call. The content of each slot is free natural language.

```yaml
triple:
  id: <local-id>                    # required, unique within parent intent (the "clause id")
  subject: <free natural language>  # what is being constrained (affirmative noun phrase)
  predicate: <free natural language> # affirmative verb / verb-phrase
  object: <free natural language>   # the target of the relationship (affirmative noun phrase)
  polarity: positive | negative     # optional, default positive — see below
  quantifier: <enum>                # optional, default existential — see below
  scope: <free natural language>    # optional, bound for the quantifier
```

The intent's `obligation` provides modal force; `polarity` provides negation as a structural property.

**Polarity model (NEW v9, supersedes the affirmative-only-by-rewriting model that compounded in earlier v9 drafts).** Negation is a documented LLM weak spot — the Verifier evaluating a negated English assertion must compute affirmative entailment AND invert it, compounding two error modes. Earlier v9 drafts dropped the `negated` flag and pushed negation into noun-phrase rewriting (`"is isolated from"`, `"runs in a sandboxed environment with no real connections"`). That model relocated the problem rather than solving it: parsers had to chase an ever-expanding lexicon of subtle negation markers (`excludes`, `lacks`, `omits`, `fails to`, …), authors learned lexicon games, and the canonical worked example violated its own parser.

v9 takes a different cut, inspired by Rego (predicate polarity separate from predicate content) and Alloy (`no x : X | P[x]` wrappers around positive predicates):

- **Slots stay affirmative.** Subject, predicate, and object are always positive English. Parser rejects matrix-predicate negation markers (`not`, `never`, `fails to`, `excludes`, `lacks`, etc. — see §3.1.1) in the predicate slot.
- **Polarity is structural, not lexical.** When the author means "this must NOT hold," they set `polarity: negative`. The slots still describe the positive claim.
- **The LLM never sees negation.** The runtime ALWAYS frames the Verifier's question affirmatively: *"In this code, does `<subject>` `<predicate>` `<object>` hold?"* The LLM returns `pass | fail` on the affirmative claim. The runtime inverts the verdict when `polarity: negative`. Negation handling is moved OUTSIDE the LLM call entirely.

This is strictly cleaner than either earlier model: authors write what they mean structurally, the parser doesn't chase lexicon, and the Verifier prompt is unambiguous. The remaining lexical rule (§3.1.1) catches matrix-predicate negation in *predicate slots* as an author-error signal (the author should have used `polarity: negative` instead).

**Constituent negation in noun phrases is legal.** A subject or object phrase like *"a function with no required arguments"* or *"a sandboxed environment with no database connection"* uses negation as part of a positive concept's description (the NP refers to *pure functions* / *sandboxed environments*, both positive concepts). The parser's matrix/constituent distinction (§3.1.1) allows constituent negation inside NPs while rejecting matrix-predicate negation. This eliminates false positives like rejecting *"a type with no required fields"* — a legitimate affirmative noun phrase.

Quantifier values:

| Quantifier | Meaning |
|---|---|
| (omitted) / `at-least-one` | Existential: ∃ x. predicate(subject, x) — default |
| `each` | Universal: ∀ x. predicate(subject, x) |
| `exactly-one` | ∃! exactly one |
| `at-most-one` | 0 or 1 |
| `none` | 0 |
| `at-least-N` (e.g., `at-least-3`) | Cardinality ≥ N |
| `at-most-N` (e.g., `at-most-3`) | Cardinality ≤ N |

The optional `scope:` slot bounds the quantification when needed ("per inserted notification", "per request", "across the response body").

```yaml
triples:
  - id: query-param
    subject: "list endpoints"
    predicate: "accept"
    object: "a cursor query parameter named 'cursor'"
  - id: cursor-pagination
    subject: "list endpoints"
    predicate: "use"
    object: "cursor-based pagination"
  - id: offset-pagination-prohibited
    subject: "list endpoints"
    predicate: "use"
    object: "offset-based pagination (skip / limit / page-number)"
    polarity: negative                   # affirmative slot; structural negation
  - id: publish-per-insert
    subject: "the publish loop"
    predicate: "emits"
    object: "a SyncEvent on the notification channel"
    quantifier: exactly-one
    scope: "per inserted notification row"
  - id: no-raw-sql
    subject: "the service layer"
    predicate: "constructs queries via"
    object: "raw SQL string templates"
    polarity: negative                   # affirmative slot; structural negation
```

### 3.1.1 Negation detection rules — matrix vs constituent (NEW v9)

The parser distinguishes **matrix-predicate negation** (the triple's verb itself is negated — rejected) from **constituent negation inside a noun phrase** (legal — part of a positive concept's description).

**Matrix-predicate negation lexicon (rejected in `predicate` slot at load time).** Sentence-level negation markers plus affirmative-grammar markers that smuggle negation through nominalization:

| Form | Markers |
|---|---|
| Explicit negation | `not`, `n't`, `never`, `cannot`, `must not`, `does not`, `is not`, `do not`, `did not` |
| Affirmative-failure | `fails to`, `refrains from` |
| Set-complement nominalizations | `absent`, `missing`, `lacks`, `lacking`, `omits`, `excludes` |
| Refusal verbs | `forbids`, `prohibits`, `prevents`, `disallows`, `denies`, `rejects`, `refuses`, `bars` |
| Privative adjectives | `devoid of`, `free of`, `free from` |

These mean "the matrix claim is negated" — and that's exactly what `polarity: negative` exists to express. Authors who write them in the predicate slot get rejected at parse with a hint pointing to `dusk/author/polarity-decision`.

**Subject and object slots** only reject sentence-level negation auxiliaries (the explicit `not`/`is not`/`does not` set) when attached to a matrix verb inside the slot. Constituent negation inside an NP is allowed:

| Phrase | Slot | Legal? |
|---|---|---|
| `"a function with no required arguments"` | subject / object | ✓ Constituent (the NP refers to a positive concept: pure-function-like) |
| `"a sandboxed environment free of network access"` | subject / object | ✓ Constituent |
| `"the type lacks a discriminator"` | predicate | ✗ Matrix (rewrite as positive + `polarity: negative`) |
| `"the function does not return null"` | predicate | ✗ Matrix |

Implementation: a lightweight POS scanner identifies matrix-verb position in the predicate slot using auxiliary-verb adjacency rules (~200 LOC, no ML dependency). Subject/object scanning checks only for the explicit-negation subset attached to verbs. See Sprint 1.

### 3.2 Composition operators

Multiple triples in an intent compose via `all` (default), `any`, `none`, or `implies` (new in v9).

`all`, `any`, `none` are the v8-era operators (conjunction, disjunction, negated-disjunction).

**`implies` (NEW v9)** splits the triple list into `antecedent` and `consequent` groups. The intent is satisfied iff: when the antecedent triples hold, the consequent triples also hold. When the antecedent does NOT hold, the intent is trivially satisfied (the consequent isn't required).

This closes the v8 expressiveness gap for conditional rules — "if X then Y must hold" — that previously had to be smuggled into multiple intents linked by `relates_to`.

```yaml
id: api/secure-endpoint
obligation: must
compose: any
triples:
  - id: jwt
    subject: "the endpoint"
    predicate: "validate"
    object: "a JWT bearer token via the Authorization header"
  - id: mtls
    subject: "the endpoint"
    predicate: "validate"
    object: "an mTLS client certificate at the TLS handshake"
```

```yaml
id: api/idempotency-on-writes
obligation: must
compose: implies
antecedent:
  - id: is-write
    subject: "the endpoint"
    predicate: "is decorated with"
    object: "api/write-endpoint"
consequent:
  - id: validates-idempotency
    subject: "the endpoint"
    predicate: "validate"
    object: "an idempotency key on the Idempotency-Key header"
  - id: stores-idempotency
    subject: "the endpoint"
    predicate: "persist"
    object: "the idempotency key + response under a stable lookup"
```

The operators in v9 are: composition (`compose: all | any | none | implies`), modality (`obligation: must | should | may`), cardinality (the `quantifier` field on triples), polarity (`polarity: positive | negative` on triples), and structural relationships (`relates_to` typed edges, §2.1). Everything else lives in the triple's content.

### 3.2.1 Antecedent evaluation is deterministic, not LLM-judged (NEW v9)

For `compose: implies` intents, antecedent triples are restricted to **decorator-index facts only**. The Verifier evaluates antecedents by index lookup — **never** by LLM semantic judgment. Consequents retain full NL freedom and are LLM-evaluated against scoped code evidence.

**Why this restriction.** Letting the LLM evaluate the antecedent creates a compounding-error trap: if the antecedent is judged probabilistically wrong (false negative on *"the endpoint is decorated with api/write-endpoint"*), the whole rule becomes silently vacuously satisfied — every consequent failure is suppressed. This is the worst possible failure mode for a `must`-level rule. The asymmetry mirrors deductive logic: premises must be facts, conclusions can be judgments.

**Closed antecedent predicate vocabulary.** Antecedent triples accept only these predicates:

| Predicate | Object form | Meaning |
|---|---|---|
| `"is decorated with"` | `<intent-path>` or `<intent-path>[<aspect>]` | Unit-under-evaluation carries that decorator (and optionally that aspect) |
| `"claims any aspect of"` | `<intent-path>` | Unit carries any aspect of that intent |
| `"is enclosed by a decoration of"` | `<intent-path>` | An enclosing scope (file or directory) carries that intent |

**Disallowed antecedent shapes** (parser-rejected at load):

| Shape | Why |
|---|---|
| Type-system facts (`"returns Promise<T>"`) | Requires TS compiler invocation; portability broken |
| Control-flow facts (`"has a try block"`) | AST-dependent; portability broken |
| Behavioral claims (`"performs a database write"`) | This IS what consequent triples evaluate — antecedent would recursively spawn Verifier |
| Cross-file references (`"anywhere in this package"`) | Antecedent stays scoped to the code unit being checked |

**Antecedent evaluation procedure** (no LLM call):

1. Resolve every antecedent triple to an index query. `subject` (e.g., `"the endpoint"`) binds to the unit-under-evaluation provided in the Verifier spawn payload.
2. Execute each query against the session-snapshot index (§2.10) + the bead delta if applicable.
3. Combine antecedent triple results per the antecedent group's conjunction semantics (all must hold; polarity `negative` on an antecedent triple is a set-complement query — *"the unit is NOT decorated with X"*).
4. **If antecedent group evaluates to FALSE** → Verifier emits `accept` with `aggregate_rationale: "antecedent did not hold; consequent not required"`. Trace records `implies_antecedent_held: false`. Consequents are NOT evaluated.
5. **If antecedent group evaluates to TRUE** → standard LLM Verifier procedure runs on consequent triples with full focal+support evidence reading.

**Ambiguity handling.** An antecedent is "ambiguous" only if the index lookup is itself ambiguous (e.g., the unit-under-evaluation can't be uniquely resolved). The Verifier returns `verifier_evidence_too_large` (App. A.11) — a structural failure, not a vacuous-satisfaction fallback. There is no LLM fallback for antecedents.

The `dusk/verifier/implies-evaluation` skill (Sprint 3) encodes this two-path structure; the Verifier prompt template explicitly states *"Antecedents have ALREADY been evaluated deterministically — you receive only consequent triples to evaluate."*

### 3.3 Validation as triple evaluation (updated for focal+support)

The Verifier sub-agent receives, per intent being checked:

- The intent's description, obligation, compose rule
- The intent's full list of triples
- **For each aspect being verified: the focal claimants (lines decorated `@intent ... [aspect]`) and the support claimants (lines decorated `@intent-support ... [aspect] [triple]`), each with their source location**
- The decorator's aspect list (which triples this claim addresses)

For each triple in the relevant aspect set, the Verifier reads the focal claimants (the lines that ARE the aspect's achievement) and their support claimants (the supporting structural context), and evaluates: *in this code, does `<subject>` `<predicate>` `<object>` hold?* — always framed affirmatively, regardless of the triple's `polarity` field. Cardinality is checked against the triple's `quantifier` field (default existential).

**Polarity inversion at the runtime layer (NEW v9).** The Verifier's prompt-builder always frames the question affirmatively — the LLM never sees `"does X NOT hold?"`. After the LLM returns its pass/fail verdict, the runtime inverts when `polarity: negative`. This moves negation handling outside the LLM call entirely, eliminating the inversion-error compounding documented in §3.1.

**Two-verdict-per-triple output (NEW v9).** The Verifier returns two distinct verdicts per triple:

- **`focal_verdict: "pass" | "fail"`** — does the focal claimants' code satisfy this triple's affirmative claim (post-polarity-inversion)? This is the verdict that drives the Engineer's re-draft decision.
- **`support_quality: "ok" | "low_confidence"`** — aggregate across the triple's support claimants: do the inline `@intent-support` NL triples accurately describe their statements? Surfaces as a decoration-quality signal for `/dusk-doctor`; does NOT by itself trigger Engineer re-draft.

The separation prevents low-quality support triples (a decoration issue) from masking or fabricating focal-verdict failures, and lets the Engineer's next-iter prompt receive an unambiguous repair signal.

**Per-support-claim verdicts (NEW v9).** Each support claim under a triple's evidence gets its own typed verdict:

- **`triple_verdict: "matches" | "mismatch" | "vague"`** — `matches` = the support's inline NL triple accurately describes the statement; `mismatch` = the triple claims something the statement doesn't do; `vague` = triple too underspecified to verify.

`support_quality` is computed from these: any `mismatch` → `low_confidence`; ≥50% `vague` → `low_confidence`; else `ok`.

**Why the focal/support distinction matters for verification:** the Verifier no longer reads the whole function body to evaluate each aspect. It reads only the lines decorated as participating in this specific aspect, scoped by the focal/support graph. For a function carrying five intents with multiple aspects each, this means five Verifier evaluations each scanning ~3-8 lines instead of the full 90-line body. Per-aspect verification becomes both more accurate (narrower context) and cheaper (smaller input).

The Verifier returns per-triple verdicts (focal_verdict + support_quality + per-claim triple_verdicts) with quoted evidence and a per-intent aggregate per the `compose` rule.

### 3.4 Test pyramid as child intent suffixes (new in v9)

Three reserved hierarchical suffixes encode the test pyramid:

| Suffix | Pyramid layer | Typical triples assert |
|---|---|---|
| `<intent>/unit-tests` | Unit | Coverage of valid cases, error cases, edge cases; no DB / network / HTTP; deterministic |
| `<intent>/integration-tests` | Integration | Coverage of cross-component behavior; uses real DB and real adapters where the parent intent's domain crosses them; no external services |
| `<intent>/e2e-tests` | End-to-end | Coverage of full user journeys touching the parent intent; uses real HTTP and real database; may use mocked external APIs |

A test intent's triples follow the same NL-triple structure as implementation intents. They assert what the test corpus must cover.

The Test Runner sub-agent (Ch. 9) discovers test files via `@intent-test-file` decorators and individual test declarations via `@intent-test` decorators, executes them through the project's test runner (Vitest in this repo), and reports per-test-intent verdicts back through the pipeline.

**Test-identity is the suffix; the marker locates the body (D.32).** Whether an intent IS a test intent — and therefore is routed to the two-stage test pre-pass rather than ordinary verification — is decided by its **authored path suffix** (does the path end in a configured `test_pyramid.suffixes` value), the single source of truth across the verifier, the orchestrator, and `dusk_inspect`. The `@intent-test`/`@intent-test-file` marker is **not** what makes an intent a test intent; its job is to locate *which file* is the test body the pre-pass reads. A test-suffix intent therefore can never silently fall through to ordinary verification; a missing test marker fails loud (`test_intent_no_test_marker`) and is rejected at write time by the reverse of gate Check 9 (`non_test_marker_on_test_intent`). See App. D.32.

**Two-stage satisfaction for test intents (clarified in v9).** A test intent is fully satisfied only when BOTH:

1. **The Verifier validates the test code itself** — the same focal/support procedure (Ch. 3.3) runs against test code. The Verifier evaluates whether the test body *actually verifies what the test-intent triple claims*, not just whether the file has the right annotations. A triple `covers-persist-first: "the unit test suite include a passing case for db.insert being called before any pubsub.publish call"` is only satisfied when the Verifier confirms there is a test body that asserts ordering between those calls (e.g., via mock call-order assertions). A test that runs `db.insert(...); pubsub.publish(...); expect(true).toBe(true)` passes at runtime but FAILS the Verifier — it doesn't verify what the triple claims.
2. **The Test Runner executes the tests** and reports pass/fail/duration per test. Only tests that satisfied (1) feed (2).

This closes the "tests exist but verify nothing" gap. The Verifier sees test code via the standard short-cycle loop (Step 4); the Test Runner runs only verified tests (Step 6).

**Hierarchical satisfaction:** an implementation intent `X` is fully satisfied only when its own triples pass AND its children — including `X/unit-tests`, `X/integration-tests`, `X/e2e-tests` if they exist — are satisfied. This means tests are not optional artifacts; they are part of the intent satisfaction surface. The Test Runner produces the runtime verdicts; the Verifier produces the behavioral-evaluation verdicts; both feed the rollup.

**Configurable suffixes (new v9).** The three reserved suffixes are the v1 defaults but extensible via `dusk.config.yml`:

```yaml
test_pyramid:
  suffixes: [unit-tests, integration-tests, e2e-tests, contract-tests, property-tests]
```

Real codebases need additional layers (contract / property / mutation / fuzz / golden / perf). v1 ships with the three core suffixes; projects extend the list as needed. The Test Runner discovers all configured suffixes generically.

### 3.4.1 Test-Verifier livelock detection and escalation (NEW v9)

Two-stage test satisfaction creates a distinct failure mode: the Verifier persistently rejects Engineer-authored test code because the test triple is genuinely difficult to verify by the test body's natural patterns. The bead loops on test authoring without breakout — same triple, similar rationales, structurally-distinct test approaches, no convergence. Currently this would surface as opaque "tests failed convergence." v9 detects the failure shape and produces a structured payload the user can act on.

**Detection rule (Bead Orchestrator, after each Verifier verdict on test code):**

The unsatisfiable-triple detector fires when ALL three conditions hold:

1. **Same failing test-intent triple across ≥3 consecutive iterations.** (The Engineer can't find any approach satisfying it.)
2. **Verifier rationale slot-focus concentration ≥80% on a single slot** (subject / predicate / object). The Bead Orchestrator extracts the slot-focus from each rejection using a deterministic keyword classifier (no LLM call) over the matrix-predicate vocabulary (§3.1.1). High concentration indicates the Verifier disagrees on the same dimension — coherent unsatisfiability shape, not random noise.
3. **Structural test-approach diversity ≥3.** The Engineer tags each test attempt with a structural identifier from a controlled vocabulary (`mock-call-order`, `time-spy`, `state-observation`, `snapshot-of-events`, `instrumented-mock`, `dependency-injection-stub`, …) maintained in the `dusk/engineer/test-approach-taxonomy` skill. Diversity ≥3 eliminates the "Engineer is just bad at this" confound.

When the detector fires, the Bead Orchestrator emits a `TestVerifierLivelockReport` and pauses the bead. The detector fires EARLIER than the per-bead iteration budget (§6.4.1) because the shape of failure — same triple, similar rationale — is more actionable than exhaustion.

**`TestVerifierLivelockReport` schema:**

```typescript
type TestVerifierLivelockReport = {
  schema_version: 1;
  bead_id: string;
  test_intent_path: string;            // e.g. "notifications/send/unit-tests"
  failing_triple_id: string;           // e.g. "covers-persist-first"
  failing_triple: {
    subject: string; predicate: string; object: string;
    polarity: "positive" | "negative";
  };
  iterations_rejected: number;
  engineer_attempts: {                  // distilled from bead memory dual-channel (§9.6.1)
    approach_label: string;             // structural id from test-approach-taxonomy
    test_excerpt: string;               // 5-10 lines of the test body
    verifier_rejection_summary: string;
    triple_slot_focus: "subject" | "predicate" | "object";
  }[];
  verifier_persistent_rationale: {
    slot_focus_distribution: { subject: number; predicate: number; object: number };
    common_phrase: string;              // shared substring across rationales
    full_rationales: string[];          // for user reading
    confidence: "high" | "medium";      // high if rationale token overlap >70%
  };
  suggested_resolutions: [
    { verb: "accept_test_as_is";
      requires: "manual override; commit carries Verifier-bypassed-test-intent trailer";
      risk: "annotation may not match test body; future verification will re-flag"; },
    { verb: "modify_triple";
      requires: "scoped dusk_author_continue keyed to the failing triple";
      proposed_rephrasing: string | null; },
    { verb: "escalate";
      requires: "freeze bead per Level 3 recovery (§6.4.1); operator inspects manually"; }
  ];
};
```

**Resolution UX.** The user responds via the new MCP tool `dusk_resolve_livelock({bead_id, verb, payload?})`:

- **`accept_test_as_is`** → commit proceeds with `Verifier-bypassed-test-intent: <test_intent_path>[<triple_id>]` trailer. Bead exits Step 4 to Step 5.
- **`modify_triple`** → opens a scoped `dusk_author_continue` (Sprint 8 author flow) keyed to the failing triple. On finalize, Step 4 re-enters with the refreshed intent.
- **`escalate`** → invokes Level 3 freeze (§6.4.1). Worktree + bead memory preserved for manual inspection.

The decision tree is encoded in `dusk/orchestrator/livelock-escalation-routing` (Sprint 6 skill) — slot-focus on predicate or object suggests the triple is unverifiable as worded (route → Author for `modify_triple`); slot-focus on subject suggests an authoring naming error (also Author); absence of livelock signal but high iter count routes to Engineer with structural-diversity requirement.

**Asymmetry preservation.** The livelock detection and routing happens entirely in the Bead Orchestrator's scope. The Verifier remains fresh-per-call with no knowledge of livelock state; its spawn payload is unchanged from iter 1. This preserves the Engineer ⊥ Verifier asymmetry that §7.5's fresh-Verifier audit validates.

### 3.5 Vocabulary — derived, not stored

Recurring noun phrases in triples are not centralized. The runtime provides a `dusk_inspect` query that extracts unique phrases from the triple corpus and frequency-ranks them — useful for spotting drift without a parallel-truth artifact.

If a project later needs a curated SSoT for DDD ubiquitous-language reasons, that's a v1.x addition with enforcement (triples constrained to vocab terms).

---

## Chapter 4: The Decoration Model (new chapter)

This chapter defines how decoration works for non-declaration code, what the focal/support distinction means in practice, why cross-cutting intents go on the touching code, what code style decoration mandates, and how the PreToolUse gate enforces it all.

### 4.1 The decoration contract: every statement has a role

In v9, **every statement and every block inside a decorated declaration has explicit decoration**. There is no implicit coverage from the enclosing declaration. This contract is stated here for comment-bearing code (inline `// @intent`); it is **completed for comment-less formats** (strict JSON and the like, which cannot carry an inline comment) by the per-file sidecar in §4.5.4 — so "total decoration" is genuinely total across every file, not only the commentable ones.

The two markers for non-declaration code:

- `@intent <intent-path> [<aspect-id>, ...]` — focal claim. This statement IS the focal achievement of the named aspect(s). Without this statement, the aspect does not hold.
- `@intent-support <intent-path> [<aspect-id>, ...] [<subject>, <predicate>, <object>]` — supporting claim. This statement contributes to the named aspect. The NL triple `[subject, predicate, object]` documents the statement's structural role.

A single statement may carry multiple decorators if it touches multiple intents (one decorator per intent). The same statement may not carry both `@intent` and `@intent-support` for the same intent — that's a contradictory role assignment.

Statements that don't participate in any intent must be marked with `@intent-ignore` (with the `because`/`reason` required). The PreToolUse gate (Ch. 4.6) rejects writes that produce undecorated statements inside decorated declarations.

### 4.2 Focal vs support: when to use which

The distinction:

- **Focal (`@intent`)** — the statement IS what makes the aspect happen. Remove it, and the aspect is no longer satisfied. There is typically one focal statement per (intent, aspect) within a given function.
- **Supporting (`@intent-support`)** — the statement contributes to the aspect's achievement: it prepares input for the focal statement, validates a precondition, packages the output, etc. Multiple support statements per (intent, aspect) is normal.

Example: an intent `notifications/send` with aspect `persist-first` (the function must persist notifications to the database before publishing sync events). Inside the function:

```typescript
// @intent-support notifications/send [persist-first] ["the row builder", "constructs", "a notification row per target user from the payload"]
const rows = userIds.map((userId) => ({ userId, title: payload.title, body: payload.body, actionUrl: payload.actionUrl ?? null }));

// @intent notifications/send [persist-first]
const inserted = await db.insert(notifications).values(rows).returning();
```

The `db.insert(...)` line is the focal statement — it IS the persistence step. The `rows = userIds.map(...)` line supports it by constructing the input.

When the Verifier evaluates `persist-first`, it reads the focal statement (the insert) plus the support statement (the row builder). Two lines, scoped — not the full 90-line function body.

### 4.3 Cross-cutting intents: decorated on the code that touches them

Cross-cutting intents (e.g., `db/use-drizzle-orm`, `observability/structured-logging`, `error-handling/observable-failures`) are concerns that apply across many code sites. In v9, **decoration follows touch**: a function that uses Drizzle declares `@intent db/use-drizzle-orm` at the function level, AND every Drizzle call site inside the function carries `@intent-support db/use-drizzle-orm` with a NL triple describing that specific call.

```typescript
// @intent notifications/send [persist-first, publish-sync-per-insert, respect-opt-out, cleanup-device-not-registered, persistence-not-blocked-by-push]
// @intent db/use-drizzle-orm [typed-queries-only]
// @intent observability/structured-logging [structured-payloads]
// @intent error-handling/observable-failures [catch-log-continue]
// @intent sync/pubsub-on-create [event-per-insert]
export async function sendNotification(...) {
  // body: each Drizzle call inside carries @intent-support db/use-drizzle-orm
  // each pubsub publish carries @intent-support sync/pubsub-on-create
  // each getLogger().info/error carries @intent-support observability/structured-logging
  // the try/catch block carries @intent-support error-handling/observable-failures
}
```

**Why this is the right model:**

- **Visibility.** A reader (the Verifier) seeing only the function declaration knows which cross-cutting intents this function touches. No traversal up to a directory `.intent` file required.
- **Scoping for verification.** The Verifier evaluating `db/use-drizzle-orm` for this function reads only the function-level decoration plus the per-call `@intent-support` claims — bounded, not the whole file.
- **Refactor safety.** When a function stops using Drizzle (because the DB layer was migrated), the function-level `@intent db/use-drizzle-orm` decorator is removed by the Engineer. The PreToolUse gate detects the inconsistency between removed decorator and remaining Drizzle calls.

Directory-level `.intent` files retain a role for **structural directory invariants** that are not per-function: "this directory contains only pure leaf code (no infrastructure imports)", "this directory's exports are the public API of the package", "this directory uses ESM throughout". Such invariants are properties of the directory as a unit, not properties of individual functions.

### 4.4 Inline NL triples on `@intent-support`

The `@intent-support` triple `[subject, predicate, object]` is inline, not referenced from a sidecar file. This is a deliberate choice with a clear rationale.

**Why inline:**

- **Single source of truth per claim**, colocated with the claim.
- **No drift** between code and triple.
- **Verifier reads one buffer per aspect**, not two.
- **Refactoring stays atomic** — changing the supporting statement requires updating its triple in the same edit.

The cost — visual verbosity — is paid by an AI reader that does not care about line length. Humans do not read this code; Verifier sub-agents do.

The triple's three slots:

- **subject** — what does the statement do, named as a noun phrase (e.g., "the row builder", "the channel publish call", "the error log")
- **predicate** — what action it performs, as a verb (e.g., "constructs", "delivers", "records")
- **object** — what is acted on / produced, as a phrase (e.g., "a notification row per target user", "the sync event to the channel via pubsub", "the push failure with err object for observability")

The triple should be specific enough that the Verifier can confirm the statement's described role matches its actual behavior. Vague triples are caught by the Verifier as low-confidence support claims and reported as decoration quality issues.

### 4.5 The decoration-completeness mandate (HARD MANDATE)

A single rule governs code structure under v9:

> **Every line, call, assignment, statement, expression, and lambda body — and their contents — must be covered by intent decorators appropriate to their participation. When a code unit's contents include operations whose intent participation differs from the unit's decoration, the unit is decomposed so each sub-operation can be decorated appropriately.**

There is no per-syntax rule table. The principle is intent-driven: code structure follows decoration needs. Code is kept together when its operations share an intent footprint; it is decomposed when intent participation diverges. The mandate is also **format-agnostic**: it binds comment-less files (configs, manifests) exactly as it binds source, via the sidecar mechanism and the single `decoration.ignore` exemption set — see §4.5.4.

#### 4.5.1 How the mandate is applied

When the Engineer drafts code, it asks for each candidate statement: *what intents do this statement's contents participate in?* Then it compares to the statement's decorator set. The rule resolves three cases:

1. **All contents participate in the same intent set as the statement's decorators** → keep the statement as-is.
2. **A sub-operation participates in an intent NOT in the decorator set** → decompose so the sub-operation becomes its own decorated unit.
3. **A sub-operation participates in a DIFFERENT aspect** of an intent already declared on the statement → decompose if the aspects are meaningfully distinct (i.e., the sub-operation has a separable role that warrants its own decorator).

The decision is always *intent-participation-driven*. The same syntactic construct may be one statement in one context and three statements in another.

#### 4.5.2 Worked applications (cross-syntax, cross-language)

The mandate applies the same way regardless of the syntactic construct or the language. The decision is "do these operations share intent participation?", not "is this a chain / a nested call / a lambda?".

**Method chains.** `db.insert(notifications).values(rows).returning()` keeps as one statement IF all three method calls share the same intent footprint (e.g., the chain as a whole IS the focal claim for `notifications/send [persist-first]` and supports `db/use-drizzle-orm [typed-queries-only]`, and each method-call step is a Drizzle builder operation within the same intent envelope). The same chain DECOMPOSES if a step participates in a different intent — for instance, if `.returning()` were claimed as the focal step for a separate intent `notifications/send [return-ids-for-response]`, that suffix would extract:

```ts
// @intent-support db/use-drizzle-orm [typed-queries-only] [...]
// @intent-support notifications/send [persist-first] [...]
const insertBuilder = db.insert(notifications).values(rows);

// @intent notifications/send [return-ids-for-response]
const inserted = await insertBuilder.returning();
```

**Nested calls.** `pubsub.publish(syncChannel("notification"), event)` decomposes because `syncChannel("notification")` is a channel-resolution operation distinct from the publish operation — different intent role even if both touch `sync/pubsub-on-create`. Extract `syncChannel(...)` to its own statement first.

**Object literals.** `const event = { action: "created", data, timestamp: Date.now() }` keeps as one statement if `Date.now()` participates in the same intent envelope as the event construction. It decomposes if `Date.now()` claims its own intent (e.g., a separate `observability/event-timing [epoch-ms]` participation) — extract `timestamp` to its own decorated const first.

**Lambdas.** `arr.map(x => fn(x))` keeps the lambda body internal if `fn(x)` participates in the same intent footprint as the surrounding `.map(...)` call. The lambda body extracts to a named function with its own decorator when its computation has separable intent participation.

**Control flow.** Branches in `if/else` or `switch` each have their own decoration when each branch participates in different intents. Flatten to early-return or `continue` so each branch is its own decorated unit. A single-intent branch chain stays nested.

**Other languages.** The rule projects unchanged onto any language with extractable expressions. Python comprehensions (`[fn(x) for x in xs if pred(x)]`) decompose if `fn`, `pred`, and the comprehension itself touch different intents. Go method receivers decompose when intent footprints diverge. Rust trait-method chains decompose at intent boundaries. SQL CTE pipelines decompose at CTE boundaries when each CTE participates in a distinct intent. The principle is language-agnostic because it speaks about intent participation, not syntactic features.

#### 4.5.3 Why this works

- **The Engineer's authoring decision is intent-driven, not syntax-driven.** No rule cookbook to memorize, no exception list to apply.
- **The PreToolUse gate enforces a single semantic check** (Ch. 4.6, check 8): for each decorated unit, the union of intent participations covered by its sub-operations must equal the union of intents in its decorator set. When they diverge, the gate emits a `decorate-or-decompose` rejection pointing at the offending sub-operation.
- **Cross-language portability:** the rule holds in any language where code can be syntactically restructured to expose sub-units. TypeScript, Python, Go, Rust, Java, SQL — all fit.
- **The audience is not a human.** Verbosity has zero productivity cost; decoration cleanliness is the binding constraint. Traditional human-coder objections ("this chain is fine inline") assume a reader that doesn't exist in this system.

#### 4.5.4 Universal coverage: comment-less files and the ignore set (NEW v9 — App. D.28)

Total decoration is **language-agnostic**: every file that is not explicitly ignored is fully linked to intents, regardless of whether its format has comment syntax. Inline `// @intent` reaches comment-bearing code; **comment-less formats** (notably `package.json` and strict JSON, which cannot carry a comment) are covered by a **per-file sidecar** `<filename.ext>.intent` (e.g. `package.json.intent`). This is one decoration model with three parsers — inline, the directory `.intent`, and the per-file sidecar — all normalizing to the same `DecorationRecord[]` and the same derived index; it is not a second system.

**Anchoring is structural; the line view is derived.** A sidecar claim stores a **JSON Pointer** (RFC 6901) into the target (`/scripts/build`; `""` = whole file) plus its marker + intent path — never a line number. Line ranges are resolved every run by parsing the target (pointer → AST node → line span), so coverage is computed against the file's *current* structure and cannot go stale. A pointer that no longer resolves is a hard finding, not a silent skip. This is a **trade, not strict dominance**: a pointer is immune to *positional* drift (reformatting, key reordering) where the inline line model is not — traded for sensitivity to *key* drift (renaming `scripts.build` dangles the pointer, just as renaming a symbol breaks an inline reference), which surfaces as that hard finding rather than silent rot. The trade landing on the safe side is the reason a sidecar is acceptable here even though §4.4/D.11 reject sidecars for comment-bearing code (where inline is possible and mandatory).

**Coverage is computed and enforced.** "No line uncovered" is per-run set arithmetic — `uncovered = non-trivial-lines − covered − ignored` — and any gap **hard-blocks at the gate**. "Non-trivial" is defined by an explicit JSON/JSONC predicate (blank lines, structural-token-only lines, and JSONC comment lines are trivial — a comment carries no authored value and can't be pointer-anchored), never by the TypeScript closing-punctuation heuristic. Whole-file (`@intent-file` / root pointer) is the maximal tile and the floor for any unstructured target.

**The ignore set is the only exemption.** `dusk.config.yml` carries `decoration.ignore: [<globs>]` merged with project additions — the single source of truth consumed by the gate, the coverage scanner, and `dusk doctor` alike. The built-in defaults span three named categories, so the silent exemptions are explicit rather than buried in a flat list: **dependencies** (`node_modules/**`, `.git/**`), **generated/build output** (`.ia/runtime/**`, `dist/**`, `build/**`, `coverage/**`, `**/*.lock`), and **secrets** (`.env*`). This default set *is* the honest boundary of "total" — it names exactly what "every file" does not include. Two tiers, not to be confused: the **glob ignore** exempts whole files/directories that are out of scope; the per-claim **`@intent-ignore`** marker (§4 markers) exempts a specific decorated region *within* an otherwise-covered file, with a recorded because/reason. The line between "generated, so ignored" and "generated, so covered" follows a **principle, not a per-file verdict**: an artifact checked into source and *meaningfully authored against intents* (`package.json`, configs, migrations) is covered via sidecar; *pure machine build output* (`dist/`, lockfiles) is ignored. Everything not glob-ignored must be fully covered or it fails the gate.

**Comment-less coverage is verified mechanically/structurally**, never by the semantic Verifier — a manifest carries no architectural triple to judge; its claims are verified by anchor-resolution + the existing Stage-2 build/test, and reported on the mechanical channel (never blended into semantic adherence). One **accepted limitation**, recorded rather than silent: mechanical verification confirms *presence and anchoring* (every line is claimed by an intent that exists), not the *correctness of the binding* — a sidecar can validly anchor `/scripts/build` to an intent it does not truly serve, and nothing judges that mapping (config has no NL triple to discourse over). This is the price of keeping config off the semantic channel, taken deliberately.

### 4.6 The PreToolUse extension

The PreToolUse gate (v8: 5 mechanical checks) gains five new checks in v9, for a total of **10 mechanical checks**. Every check is implementable with parser / AST / index lookup — none require LLM semantic reasoning. The agentic `S ⊆ D` decorate-or-decompose check is intentionally NOT in the gate (see "Why the gate stays mechanical" below).

| # | Check | v8 / v9 |
|---|---|---|
| 1 | Decorator present on every exported declaration | v8 |
| 2 | Every `@intent`/`@intent-support`/`@intent-test` references a resolvable intent path | v8 |
| 3 | Every aspect id resolves to a triple id in the referenced intent | v8 |
| 4 | One intent per line (no `@intent X; @intent Y` on same line) | v8 |
| 5 | `@intent-ignore` has both `because=(...)` and `reason="..."` | v8 |
| 6 | **Every statement inside a decorated declaration has decoration** (`@intent`, `@intent-support`, or `@intent-ignore`) | **v9** |
| 7 | **`@intent-support` has a valid 3-slot triple `[subject, predicate, object]`** | **v9** |
| 8 | **No statement carries both `@intent` and `@intent-support` for the same intent** | **v9** |
| 9 | **`@intent-test`/`@intent-test-file` references a test-pyramid intent** (path ends in any configured `test_pyramid.suffixes` value) | **v9** |
| 10 | **No matrix-predicate negation in `@intent-support`'s inline triple `predicate` slot** (§3.1.1 lexicon) — author must use `polarity: negative` instead | **v9** |

A write that fails any check is rejected with a structured error and the Engineer sees the rejection in its next iteration. The gate is hard — there is no "warning" mode.

**The 10 checks emit 12 typed rejection kinds.** Several checks split into more than one `Rejection.kind` (App. A.8) because they detect distinct failure shapes the Engineer's feedback channel must distinguish: check 1 → `missing_decorator` (declaration) **and** `missing_statement_decorator` (statement, v9 check 6); check 2 → `unresolved_intent_path` **and** `unresolved_aspect_id`; check 5 → `missing_ignore_because`, `missing_ignore_reason`, **and** `invalid_ignore_predicate`; check 7 → `missing_support_triple` **and** `malformed_support_triple`. The mapping is 10 mechanical checks → 12 rejection kinds; conformance is verified per-kind (one fixture per kind), not per-check. *(v1.x: the universal-decoration-coverage change (D.28) adds 5 gate-only coverage rejection kinds — `malformed_sidecar`, `sidecar_target_missing`, `unresolved_anchor`, `overlapping_anchors`, `uncovered_target_lines` — which are NOT part of this v1 10-check matrix; they extend the gate surface to 17 mechanical kinds when that change lands. See App. A.8.)*

**Why the gate stays mechanical.** The decorate-or-decompose mandate (Ch. 4.5) is the design rule for code style — but it requires *semantic* understanding of intent participation to enforce (the `S ⊆ D` check needs call-graph + decorator lookup + comparison of intent sets). That's an agentic computation, not a parser pass. We keep the gate purely mechanical and defer mandate enforcement to:

1. **Engineer proactivity.** The Engineer's role prompt + skills (`dusk/engineer/decoration-completeness`, `dusk/engineer/statement-extraction`, `dusk/engineer/support-triple-authoring`) instruct it to apply the mandate as it drafts code — extract nested calls when their intent participation diverges, hoist loop-invariants, separate object construction from use, etc.
2. **Verifier surface area.** When a sub-operation participates in an intent that isn't decorated on its enclosing statement, that intent's aspect is unsatisfied (no claim exists). The Verifier reports unsatisfied aspects per intent. `dusk_inspect` shows them. `/dusk-doctor` flags them.
3. **`/dusk-doctor --static-analysis` (REPROMOTED to v1, Sprint 9 deliverable).** A non-real-time check (off the write path) runs the `S ⊆ D` analysis as part of project-wide validation. v9 originally deferred this to v1.x; reviewer feedback pulled it back into v1 specifically for **decoration-erosion detection**, NOT real-time enforcement. Run weekly during dogfooding to confirm the decoration model is holding up over iteration; surface drift trends as actionable signal.

The mandate is real and load-bearing. The mechanical gate keeps the write path fast and deterministic; the doctor's static analysis keeps the design rule from silently eroding under Engineer iteration pressure.

#### 4.6.1 The actual PreToolUse hook wire format

Dusk installs a hook handler into `.claude/settings.json` at `dusk init` time. The handler runs on Write/Edit tool calls. Wire format follows Claude Code's standard hook contract:

**Input (stdin, JSON):**
```json
{
  "tool": "Write" | "Edit",
  "args": { "file_path": "...", "content": "...", ... },
  "session_id": "...",
  "transcript_path": "..."
}
```

**Output (stdout, JSON):**
```json
{ "decision": "approve" } |
{
  "decision": "block",
  "reason": "<human-readable summary>",
  "structured_rejection": {
    "kind": "missing_statement_decorator" | ...,
    "details": { ... }
  }
}
```

The handler exits 0 on approve; the structured rejection is parsed back by the spawning Bead Orchestrator into the Engineer's feedback channel. See App. A.10 for the structured rejection schema.

This hook is **per-session** — Claude Code runs the same `.claude/settings.json` for every agent invocation in the session. The Engineer sub-agent's writes go through the same hook as any other write. Dusk's responsibility: ensure the hook is installed before `dusk_implement` runs.

**Idempotent installation with `_dusk_marker` anchor.** `dusk init` writes the Dusk hook entry with two identifying fields:

```json
{
  "_dusk_managed": "v1",
  "_dusk_marker": "dusk-pre-tool-use-gate",
  "match": { "tools": ["Write", "Edit"] },
  "type": "command",
  "command": "node node_modules/@dusk/pre-tool-use-hook/cli.js"
}
```

The `_dusk_marker` is the idempotency anchor — re-runs of `dusk init` match the entry by `_dusk_marker`, not by array position or content equality. `_dusk_managed` versions the entry so future Dusk versions can update the command path safely.

**Conflict-prompting merge strategy.** When `.claude/settings.json` already has a non-Dusk PreToolUse entry matching `Write` or `Edit`, `dusk init` does NOT silently insert. It surfaces a structured prompt:

```
Conflict: .claude/settings.json already has a PreToolUse handler matching Write/Edit:
  command: <existing command>

Dusk's gate is required for the decoration mandate. Options:
  [1] Append Dusk's hook AFTER the existing one (both run; existing runs first) — recommended
  [2] Replace the existing entry with Dusk's hook (backs up to .claude/settings.json.bak)
  [3] Abort init (integrate manually)
Choose [1/2/3]:
```

Option [1] is the safe default — Claude Code runs multiple PreToolUse entries in declaration order; if either blocks, the write is blocked. Option [2] writes `.claude/settings.json.bak` and records the replaced command as a `_dusk_replaced` field at the top of the new file for one-time recovery. Option [3] exits non-zero; `dusk init` is idempotent on retry.

**Verification via `dusk doctor --check-hook`** verifies the marker is present, the command path is resolvable, and a synthetic hook payload round-trips through the handler. Exit codes: 0 (all checks pass), 2 (configuration issue — settings.json missing / marker missing / path unresolvable), 3 (round-trip failure — handler installed but malfunctioning). The `--repair` flag re-runs the merge logic for configuration issues; round-trip failures indicate a bug and never auto-fix.

---

## Chapter 5: Intent Authoring (Phase 1)

`dusk_author(request)` runs the intent authoring sub-flow as a dialog mediated through the harness. Five stages, unchanged from v8 in structure.

### Stage 1 — Intake & Framing

The Author sub-agent clarifies the user's request: what behavior is being asserted, hard requirement vs preference vs option, where it applies, what success and failure look like, whether it's one concern or several. The Author restates the request as a candidate framing for the user to confirm.

### Stage 2 — Discovery & Tension Detection

The Author searches the intent index using **agent-driven text search** — grep / ripgrep / shell tools over the `.ia/intents/` tree, plus 1-hop `relates_to` expansion from the top hits. **v1 ships no semantic / vector / RAG layer** — search is purely textual; the Author's own reasoning interprets matches.

The Author parses each candidate match and classifies its tension with the user's framing:

- **Direct conflict** — existing intent asserts the opposite
- **Scope overlap** — existing intent already covers this concern
- **Gray area** — related but reconcilable
- **Adjacent concern** — different intent that interacts via shared decorator sites
- **Prerequisite** — the request depends on an intent that does not exist in the tree yet (NEW v9 — App. D.25)

The user picks the resolution; the Author encodes it.

**Prerequisite tensions (NEW v9 — App. D.24/D.25).** Tension detection runs in both directions: against intents that *exist* (the first four classes) and against an intent the request *depends on but that doesn't exist yet* (`prerequisite`). When the request plainly requires a capability/decision no intent provides — an endpoint depending on a not-yet-authored persistence or auth intent, or, the canonical case, the very first behavior intent of an **empty** tree depending on the project's foundation (tech-stack/module setup, app bootstrap, persistence) — the Author surfaces a `prerequisite` tension (target = the missing intent's proposed path) and steers the user to author the dependency *first* (for the greenfield foundation, in order: project/stack → bootstrap → persistence → behavior). This is the proactive, authoring-time complement to D.10 (the Decomposer's *reactive* mid-`dusk_implement` missing-intent pause): the dependency is caught before code is ever requested. It is **fully general and carries no bootstrap state into the orchestration** — a `prerequisite` is an ordinary surfaced tension that the existing flow turns into a user decision (a non-empty `tensions[]` keeps Stage 2 from auto-advancing); the pipeline gains no greenfield special-case (App. D.24), and the foundation is simply the project's first intents. A general `intent_census` (the set of intents that exist) is provided to the Author so its judgment is grounded, not guessed.

Embedding / vector search is deferred to v1.x (Ch. 8). If the intent index grows past the point where grep-style search misses relevant matches, the Author's discovery procedure gets a semantic-search skill addition — not a runtime substrate change.

### Stage 3 — Industry-Practice Injection

The Author applies **industry best practices** for the technology stack named in the user's framing, sourced from its own training and from a `dusk/author/best-practices-application` skill, NOT from a bundled canonical pattern library.

**v1 ships no canonical intent / block library at runtime.** The Author does not lookup-and-paste a pre-curated pattern. Instead, the Author's role prompt + skill instruct it to:

1. Identify the technology stack involved (e.g., "REST API with cursor pagination", "event-sourced aggregate", "feature-flagged rollout")
2. Apply known best practices from training (idempotency, retry shapes, cursor opacity, validation boundaries, observability conventions)
3. Search prior intents in this project for similar shapes (grep over `.ia/intents/`)
4. Propose a decomposition that fits the user's framing

The user accepts the proposal as-is, edits it, or rejects it (greenfield path — no pretending).

A future ecosystem deliverable may ship curated intent libraries that can be referenced or imported; that's deferred (Ch. 8). The reference intents in `packages/intents/canonical/` (if present in a repo) are documentation examples, not runtime-fetched content.

### Stage 4 — Drafting (hierarchical decomposition)

The Author drafts the full intent set with the hierarchy, granularity, triples, and `relates_to`.

**New in v9:** if the user's framing implies tests, the Author also proposes test-pyramid child intents at the appropriate suffixes (`<X>/unit-tests`, `<X>/integration-tests`, `<X>/e2e-tests`). The user confirms which pyramid layers are required for this intent (typically unit + integration for service-layer intents; unit + e2e for endpoint intents; unit-only for pure-leaf utility intents).

### Stage 5 — Commit

The Author writes intent files atomically. No code changes happen in this stage.

The sub-flow is diagrammed in `docs/diagrams/dusk-intent-creation-v2/`, and folded into the master flow diagram at `docs/diagrams/dusk-master-flow-v2/`.

---

## Chapter 6: The Implementation Pipeline

`dusk_implement(request)` runs the nine-step pipeline. The Root Orchestrator owns overall flow; Bead Orchestrators own per-bead execution; workers (Decomposer, Scout, Engineer, Verifier, Test Runner, Conflict Resolver) do specialized tasks.

### Step 1 — Request decomposition

The **Decomposer** receives the user request and the intent index. It produces a set of intents the request touches:

- Direct intents (work explicitly named or strongly implied)
- Transitive parent intents (whose descendants are touched), discovered by walking the path upward from each touched intent's id
- Adjacent intents discovered via `relates_to`
- **Test-pyramid child intents (new in v9)**: when a touched intent has `<X>/unit-tests`, `<X>/integration-tests`, or `<X>/e2e-tests` children, those are added to the intent set automatically (the Test Runner will run them in Step 6)

If new intents are needed (request implies behavior not yet covered), the Decomposer **does not auto-create them**. It signals the Root Orchestrator to invoke `dusk_author` first.

Output: an intent set plus framing for each.

### Step 2 — Bead decomposition + sequencing

The Decomposer produces a **bead DAG**:

- One bead per intent in the intent set.
- **Dependency edges (typed `relates_to`).** Edges derived from the five typed kinds (§2.1):
  - `parent` → child bead depends on parent bead.
  - `implies` → bead depends on the bead implied by it. Note: antecedent-side evaluation at Verifier time is index-lookup only (§3.2.1); Decomposer uses the relation purely for scheduling.
  - `supersedes` → no edge; superseded target is excluded from the active set.
  - `conflicts` → no edge; Decomposer flags the pair and refuses to issue beads for both in one pipeline run (returns `decomposer_bead_conflict` per App. A.11).
  - `sibling` → no edge; context only.
- **File-overlap edges (NEW v9).** For each pair of beads (a, b) where their predicted file-impact sets overlap, the Decomposer adds a synthetic serialization edge. Predicted file impact is computed from the session-snapshot index (§2.10): which files carry decorations referencing this bead's intent or its descendants. This prevents two parallel beads from racing on the same file — a common scenario in v9 because cross-cutting intents touch many files. File-overlap edges may produce a richer DAG than the bare `relates_to` graph would; this is expected and correct.
- **Cross-bead claim-overlap precondition (NEW v9 — Sprint 5).** Before issuing the DAG, the Decomposer checks whether any two beads would produce **focal** claims for the same `(intent_path, aspect_id)` (HARD refusal — returns `decomposer_bead_conflict`) OR **support** claims for the same `(intent_path, aspect_id)` on the same file region (advisory warning — surfaced in the run summary but not blocking). The hard focal-claim refusal prevents semantic ambiguity at merge time; the support-claim warning surfaces coordination smells.
- Beads with no dependency edges between them can run in parallel.

**Test-pyramid intent beads are dependent on their parent intent's bead** — tests can't be written until the implementation is in place. The DAG captures this naturally via `kind: parent` references on test intents.

**Why file-overlap edges, not just dependency edges:** v8 assumed each bead touched a small file set scoped to its intent. v9's cross-cutting decoration model (Ch. 4.3) means a single cross-cutting intent's bead (e.g., add `observability/structured-logging` everywhere) can touch hundreds of files that *also* appear in unrelated implementation beads' diffs. Without file-overlap serialization, parallel writes would conflict at merge time and the Conflict Resolver becomes a bottleneck. With file-overlap serialization, the Conflict Resolver only fires on the rare case where the Decomposer's prediction was wrong (the bead's actual writes diverge from its predicted file impact).

### Step 3 — Worktree creation

The **Root Orchestrator** materializes the DAG. Sequential beads run in-place; parallel beads each get a git worktree (`git worktree add -b dusk/<bead-id> <path> <base>`), where `<base>` is the session snapshot's **resolved merge-base SHA** — not a hardcoded `origin/main`, which a fresh standalone repo lacks. The base ref resolves `origin/main → main → HEAD` by default (explicit `--base-ref` is strict), and worktree creation requires the resolved SHA — it fails loud rather than silently defaulting (App. D.27).

### Step 4 — Per-bead short cycle (pair programming)

For each bead, the **Bead Orchestrator** runs the short cycle in its bead's worktree:

```
1. Spawn persistent Engineer (one per bead, memory: bead-scoped)
2. Iterate (iter N = 1..20):
   a. The Bead Orchestrator evaluates the STUCKNESS DETECTOR (§6.4.2) after
      every Verifier verdict on iter ≥ 3. First match — empty verdict_delta
      AND stable failing-triple set across three consecutive iters — fires
      the diagnosis early. If detector hasn't fired by N == 5, the iter-5
      hard ceiling fires the diagnosis as a fallback.
   b. When fired: Engineer writes a CONVERGENCE DIAGNOSIS to bead memory
      BEFORE drafting again. Structured block answering:
        - What specific triple keeps failing, and why?
        - Is the intent unsatisfiable as stated, or is the approach wrong?
        - Have I been trying variations of the same approach? Name the
          structurally-distinct approaches still untried.
      The diagnosis is owned by the BEAD ORCHESTRATOR — it informs routing
      decisions (escalation, recovery ladder §6.4.1, livelock detection
      §3.4.1) but does NOT enter the Verifier's spawn payload. The Verifier
      remains fresh-per-call, preserving the asymmetry per §9.2.
   c. Engineer drafts diff with full @intent / @intent-support decoration per Ch. 4.
   d. PreToolUse gate runs (10 mechanical checks, Ch. 4.6).
   e. On gate pass: spawn fresh Verifier (memory: none) with payload UNCHANGED
      across all iterations (no diagnosis injection).
   f. Verifier evaluates each relevant aspect's focal + support claimants
      (per §3.3). Antecedent triples for compose: implies intents are
      evaluated by deterministic index lookup, never by the LLM (§3.2.1).
   g. If focal_verdict: fail on any triple → deliver structured feedback to
      Engineer; loop. Note: support_quality: low_confidence does NOT
      trigger re-draft (advisory only).
   h. If all focal_verdicts pass → exit short cycle.
3. Early escalation at iter 15 if not converged: surface to user with the
   convergence diagnosis as the escalation payload (read from bead memory,
   not from any Verifier-visible state).
4. Per-bead lifetime budget: 40 total Step-4 iterations across all
   re-entries (long-cycle/test-failure bounce-backs). On exhaustion, enter
   the recovery ladder (§6.4.1). The 20-iter ceiling bounds a single Step-4
   entry; the 40-iter total bounds the whole bead.
5. Test-Verifier livelock detection (§3.4.1) takes precedence over budget
   exhaustion when both would fire.
```

**Engineer is persistent per bead** (`memory: bead`) — accumulates context across iterations via the structured format of §9.6.1. **Verifier is fresh per call** (`memory: none`) — and now genuinely fresh: the diagnosis no longer leaks into its spawn payload. See §7.5 for the fresh-Verifier audit benchmark that validates this empirically.

The iter-5 forced diagnosis (or earlier, via §6.4.2 stuckness) prevents thrashing: by iter 5 the Engineer has tried 4 approaches that didn't satisfy the Verifier. Forcing it to articulate the blocker breaks the "produce micro-variations of the same wrong approach" failure mode. The diagnosis lets the Bead Orchestrator route to escalation / livelock detection / recovery without ever contaminating the Verifier.

The iter-15 early escalation prevents wasted iteration cost in the long tail. The escalation payload is the diagnosis from bead memory, making the surface actionable.

Configuration in `dusk.config.yml`:

```yaml
sanity:
  short_cycle_max_iterations: 20         # per-Step-4-entry ceiling
  short_cycle_diagnosis_at_iter: 5       # fallback ceiling for diagnosis
  short_cycle_escalate_at_iter: 15       # early escalation threshold
  short_cycle_stuckness_window: 3        # sliding window for §6.4.2 detector
  bead_lifetime_iterations: 40           # per-bead total across re-entries
```

### 6.4.1 Per-bead iteration budget and graceful recovery (NEW v9)

Each bead carries a lifetime budget of 40 Engineer iterations summed across all Step-4 entries (initial short cycle + long-cycle regression bounce-back from Step 5 + test-failure bounce-back from Step 6 + two-stage-test bounce-back per §3.4 + livelock-resolution re-entries per §3.4.1). The 20-iter ceiling continues to bound a single Step-4 entry; the 40-iter total bounds the bead as a whole.

**"A wall-clock overrun is a continue, not a discard" (NEW v9 — App. D.26).** Each Engineer *iteration* is a single headless agent spawn, bounded by a wall-clock *backstop* (not a turn cap — capping turns would only force the next memory-less iteration to cold-re-derive the worktree, throttling the Engineer's real file work). On a wall-clock timeout the spawn **resolves with a salvage marker** — the partial draft is already on disk in the worktree — and the short cycle re-enters and continues from the existing files, rather than rejecting and being classified as a transport failure that would cold-retry the identical too-large task and discard correct work. A wall-clock overrun is never a discard-and-die; the per-entry/lifetime budgets, the stuckness detector, and the recovery ladder below remain the only bounding/termination authority. (This robustness was surfaced by the greenfield POC, where the first endpoint's bead was over-large because its foundation had not yet been authored as its own intents — the structural fix for which is D.24/D.25, after which the wall clock rarely fires at all.)

On budget exhaustion the Bead Orchestrator enters a deterministic **recovery ladder** rather than terminating with `exit(error)`. The level is a pure function of satisfaction state at exhaustion:

**Level 1 — Partial commit** (≥1 intent fully satisfied AND partial commit doesn't violate composition rules):
- Commit the subset of bead intents whose triples currently verify cleanly.
- Trailers include `Partial: true` and `Deferred-Intent: <path>` for each unsatisfied intent.
- Deferred intents written to `.ia/runtime/beads/<bead-id>/deferred.yaml`.
- Worktree merges normally per Step 8; the rebase logic recognizes `Partial: true` and suppresses `snapshot_drift` warnings for the deferred-intent additions.
- This is the most graceful exit — verifiably-correct work ships, the rest defers.

**Level 2 — Intent-modification proposal** (no intents satisfied OR partial commit would violate composition):
- The Engineer's final iteration is repurposed: produce a structured *intent-modification proposal* (which triple seems unsatisfiable as stated, what affirmative rephrasing might make it tractable, what scope narrowing would help — aggregates ALL diagnoses across the bead's lifetime, not just the last one).
- Written to `.ia/runtime/beads/<bead-id>/intent-proposal.yaml`.
- Returns `DuskError { kind: "bead_intent_revision_needed", recoverable: true, recovery_hint: "review intent-proposal.yaml and invoke dusk_author_continue" }`.

**Level 3 — Operator-actionable freeze** (Level 2's proposal generation itself fails, or Level 1 conditions don't hold):
- Worktree is preserved (NOT removed).
- Bead memory + last 3 verdicts + diagnosis history written to `.ia/runtime/beads/<bead-id>/freeze-state.md`.
- Returns `DuskError { kind: "bead_frozen", recoverable: false }`.
- User can inspect, manually fix, and `dusk implement --resume <bead-id>`.

**Level 4 — Hard abort** (Level 3 cannot serialize freeze state — disk error, etc.):
- Returns `DuskError { kind: "bead_aborted", recoverable: false }`.

The recovery ladder transitions Level 1 → 2 → 3 → 4 deterministically based on (intents_satisfied, partial_commit_valid, freeze_writable) — no random or LLM-mediated choice. Configuration: `sanity.bead_lifetime_iterations: 40`.

**Composition with livelock detection.** When test-Verifier livelock (§3.4.1) fires AND the budget is also exhausted, livelock detection wins — its payload is richer (specific failing triple + slot focus) than budget exhaustion's (generic). The user resolves livelock first via `dusk_resolve_livelock`; iteration resumes with the remaining budget.

### 6.4.2 Stuckness detector — early-fire for convergence diagnosis (NEW v9)

The iter-5 ceiling on the convergence diagnosis is a fallback. Earlier firing is driven by a **deterministic stuckness predicate** over trace events already emitted per App. A.6 — no extra LLM call.

**Predicate.** At iter K (K ≥ 3), stuckness fires if ALL of:

1. `verdict_delta_from_prior(K-2)`, `verdict_delta_from_prior(K-1)`, `verdict_delta_from_prior(K)` all have `flipped_triples == ∅` AND `new_failures == ∅` AND `new_passes == ∅`.
2. `failing_triple_set(K-2) == failing_triple_set(K-1) == failing_triple_set(K)` (derived from the Verifier's per-triple verdicts; trace-resident).

In English: three consecutive iterations where no triple moved AND the failing set is identical.

**Why three-iter window:** A single delta-zero iter is normal mid-iteration thrashing. A two-iter window catches coincidental landing on identical verdicts. Three iters is the sweet spot — requires the Engineer to have been visibly spinning for three drafts before judging stuckness.

**Composition with iter-5 ceiling:**

- Detector fires at K=3 or K=4 → diagnosis emitted early. iter-5 ceiling already satisfied; no duplicate diagnosis.
- Detector hasn't fired by iter 5 → iter-5 ceiling forces the diagnosis as fallback.
- Detector re-fires at iter ≥6 with a *different* failing-triple set → diagnosis is refreshed in-place per §9.6.1 compaction rules (overwritten, not appended).

**Implementation cost.** Zero LLM calls. ~30 LOC in the Bead Orchestrator's iteration loop (Sprint 5). Trace events include `stuckness_detector_state` for post-hoc audit. Configurable via `sanity.short_cycle_stuckness_window: 3` — can be lowered to 2 for aggressive projects or raised to 4 for tolerant ones.

### Step 5 — Per-bead long cycle (shuffle sharding)

After short-cycle acceptance, the Bead Orchestrator runs the long cycle in the same worktree:

```
1. Compute affected universe (v1 — two sets, combined):
   - Direct: claims modified in this bead's diff
   - Adjacent: claims in files importing from or imported by this bead's files (1-hop)
   Universe = direct ∪ adjacent.
   (Noun-phrase-shared expansion deferred to v1.x; see Ch. 8.)
2. For round in 1..N (default N=10, see dusk.config.yml long_cycle_round_count):
   - Sample one random unique (intent_path, claimant) tuple from universe minus already-tested
   - Spawn fresh Verifier
   - Record verdict
   - CONFIRMED-REJECT EARLY-STOP (NEW v9): on first reject in the round set,
     spawn N=2 additional fresh Verifiers against the SAME sampled tuple
     (distinct call-ids; payload identical; memory: none enforced as usual).
     Each confirmation call is traced with `confirmation_of_trace_id: <original>`
     for fresh-Verifier audit aggregation per §7.5.
       * If ≥1/2 confirm reject → regression confirmed; emit report, exit.
       * If both override to accept → original reject treated as variance noise
         (Verifier-flake); record `confirmation_pass_outcome:
         flaky_verdict_dismissed` in trace; continue sampling.
     Confirmation pass fires only on the FIRST reject per long-cycle round
     set, not on every subsequent reject — keeps cost bounded.
   - Stop early if universe is exhausted
3. If a confirmed regression is detected:
   - Emit structured regression report
   - Re-enter Step 4 with the regressed intent added to the active set
4. If all rounds pass: proceed to Step 6
```

### Step 6 — Test execution (new in v9)

After long-cycle pass, the Bead Orchestrator spawns the **Test Runner**:

```
1. Scope discovery:
   - Identify all test-pyramid intents in the bead's intent set (paths ending /unit-tests,
     /integration-tests, /e2e-tests)
   - Resolve test code via @intent-test and @intent-test-file decorators referencing those intents
   - If no test code exists for a required test-pyramid intent: emit "missing tests" feedback
     and re-enter Step 4 with instruction to author tests
2. Test execution:
   - For each layer (unit, integration, e2e) present in the bead's test scope:
     - Invoke the project's test runner with the resolved test file paths
       (e.g., vitest <path1> <path2> ... for this repo)
     - Capture pass/fail per test
3. Verdict computation:
   - For each test-pyramid intent, evaluate its triples (affirmative-only in v9) against the executed tests:
     - "covers-X" triples are satisfied when at least one passing test maps to aspect X
     - "isolates-from-Y" triples (or analogous affirmative phrasings of "no dependency on Y") are satisfied when the test corpus matches the affirmative assertion
     - Triples with `quantifier:` (e.g., `exactly-one` test per aspect, `each` test runs under N ms) are evaluated against the test corpus's matching count
   - Produce per-test-intent verdicts
4. If any test-pyramid intent fails:
   - Emit structured feedback (which test-intent, which triple, which test result)
   - Re-enter Step 4 with the failing test-intent in scope
5. If all pass: proceed to Step 7
```

The Test Runner's tool scope is `[Read, Bash(test-runner)]` — Read for resolving test files via the index, Bash scoped to the project's configured test runner command (Ch. 9.5). It does NOT have Write or Edit; failing tests trigger a return to the Engineer, not in-place fixes.

**Why Test Runner is its own role (not a sub-procedure of Bead Orchestrator):** the Bash tool scope it needs (running the test runner) is broader than other workers should have, and the test verdict computation is structured work with its own input/output contract. Isolating it as a role makes the tool boundary tight and the contract explicit.

### Step 7 — Atomic commit

After test execution pass, the Bead Orchestrator commits:

```
feat(<scope>): <subject line>

<optional body paragraphs>

Intent: <intent-path> [<aspect-id>, ...]
Intent: <intent-path> [<aspect-id>, ...]
Test-Intent: <intent-path>/unit-tests
Test-Intent: <intent-path>/integration-tests
Bead-id: bd_<timestamp><seq>
Verdict-id: vd_<timestamp><seq>
Trace-id: tr_<timestamp><seq>
Verifier-model: <model-id>
Test-Runner-model: <model-id>
Long-cycle-samples: <count>
Test-Suites-passed: <count>
```

Conventional Commits format. Test-Intent trailers (new in v9) name the test-pyramid intents that were executed and passed for this bead. Test-Runner-model and Test-Suites-passed trailers carry test metadata.

### Step 8 — Worktree merge (if parallel)

After all parallel beads' commits land on their worktree branches, the Root Orchestrator integrates:

```
1. Topologically order the worktree branches (per the DAG)
2. For each branch in order:
   - git rebase dusk/<bead-id> onto main
   - If conflicts: spawn Conflict Resolver sub-agent with both branches' diffs
3. git worktree remove dusk/<bead-id>
```

### Step 9 — Return summary to harness

```typescript
{
  commits: string[],
  beads_summary: BeadSummary[],
  intents_touched: string[],
  test_intents_executed: string[],   // new in v9
  trace_ids: string[],
  total_duration_ms: number,
  total_cost_usd: number
}
```

---

## Chapter 7: The Verifier — Model & Observability

### 7.1 Single frontier-tier model for v1 (determinism-first)

v1 uses a **single frontier-tier model** across all roles. The earlier "mid-tier" framing is superseded: v1 is **not built to scale**, and the priority is *determinism and judgment quality*, not cost. Leaning on a frontier model — combined with the polarity/quantifier/antecedent machinery that moves the hardest logic *outside* the LLM call — is what makes single-shot structural verdicts stable enough to test against. Engineer, Verifier, and Test Runner all default to the same frontier tier in v1.

**`temperature: 0` for verdict calls.** Verifier and Test-Runner verdict computations run at temperature 0, so the LLM-mediated portion of the pipeline is as close to deterministic as the model allows. (The two places the architecture deliberately *wants* sampling variance — the §7.5 fresh-Verifier audit and the §6.5 N=2 confirmation pass — are handled with explicit N and statistical thresholds, not single-shot asserts.)

**Tier-down is an optimization, deferred to efficacy testing.** Whether a cheaper/faster model suffices per role (e.g., a frontier Verifier + a faster Engineer) is established by the Sprint-9 benchmark (§7.3, §7.5), not guessed up front. The default model is a runtime configuration knob (`dusk.config.yml > models`) with per-role overrides; v1 ships with a frontier default and supports swapping. We optimize the model substrate once we are measuring the system's efficacy — not before.

### 7.2 Benchmarking trace stream

Every sub-agent call emits a structured trace event:

```typescript
type SubAgentTrace = {
  trace_id: string;
  bead_id?: string;
  parent_trace_id?: string;
  role: "root-orchestrator" | "bead-orchestrator" | "decomposer" | "scout" | "engineer" | "verifier" | "test-runner" | "author" | "conflict-resolver";
  invocation_site: "implement" | "author" | "short-cycle" | "long-cycle" | "test-execution" | "merge";
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  cost_usd: number;
  input_summary?: object;
  output_summary?: object;
  agreement_with_pair?: boolean;
  ground_truth?: "accept" | "reject";
  test_runner_command?: string;     // new in v9; populated for test-runner traces
  test_pass_count?: number;          // new in v9
  test_fail_count?: number;          // new in v9
};
```

Traces are written to `.ia/observability/traces.jsonl` (gitignored, ring-buffered) and optionally streamed to PostHog LLM analytics or OTLP.

### 7.3 Benchmarking commercial models

A primary v1 goal is to benchmark commercial agents head-to-head — across tiers, including the mid-tier candidates a future tier-down (§7.1, App. D.21) would use. Available as both shell CLI and slash command:

```bash
dusk benchmark --models "claude-sonnet,gpt-mid,gemini-flash" \
               --intents "api/pagination/**" \
               --fixtures .ia/benchmark/seeded-violations/
```

```
/dusk-benchmark
```

Output: per-model accuracy on seeded violations, per-role-per-model performance, cross-model agreement matrix, latency and cost summaries.

### 7.4 Per-role observability

The benchmark harness answers questions like:
- Tokens-per-iteration for the Engineer role on this project
- Verifier accept rate by model on `must`-level intents
- How often the long-cycle Verifier disagrees with the short-cycle Verifier
- Which sub-agent role is the cost driver
- **(new in v9)** Test Runner pass-rate by test-pyramid layer; per-pyramid-layer authoring iteration count

### 7.5 Fresh-Verifier audit (NEW v9 — falsifiability for the Engineer ⊥ Verifier asymmetry)

The Verifier-fresh-per-call asymmetry is *the* load-bearing claim for v9's bias-resistance story. Reviewer feedback identified that "memory: none" is enforced at the application layer but does NOT guarantee behavioral independence — same model + same system prompt + nearly-identical evidence packages can produce *correlated* verdicts across "independent" Verifier calls, even without context leak.

The fresh-Verifier audit makes this falsifiable:

```
For each fixture in a curated audit set (10 known-good + 10 known-bad diffs):
  1. Run the diff through N independent Verifier calls (default N=5)
     with identical input but distinct call-ids
  2. Record per-call verdict + rationale
  3. Compute:
     - Verdict variance per fixture (Shannon entropy across verdicts)
     - Rationale similarity per fixture (token-level overlap on rationale text)
     - Aggregate variance/similarity across the audit set
```

**Pass criteria (calibrated empirically during Sprint 9):**
- On known-bad fixtures, variance should be low + verdicts consistently `reject` — Verifier reliably catches defects across all 5 runs.
- On known-good fixtures, variance should be low + verdicts consistently `accept`.
- On *controversial* fixtures (curated to be edge cases), variance should be MODERATE — neither rubber-stamp nor random.

**Failure interpretation:**
- High variance on known-bad → Verifier is unreliable; reconsider model selection (§7.1) or prompt template.
- Zero variance everywhere (including controversial) → Verifier is rubber-stamping; the "fresh" framing is functionally meaningless.
- High rationale similarity across calls → confirms behavioral correlation despite app-layer freshness.

Audit fires:
- Once per Sprint 9 benchmark run (the v1 baseline)
- On request via `dusk benchmark --audit-verifier-freshness`
- Recommended cadence post-v1: weekly during dogfooding

This is the first instrumentation that lets us *measure* whether the asymmetry actually holds — until v1 ships this benchmark, "fresh per call" is an architectural assertion, not a verified property.

### 7.5.1 Citation precision — the third audit axis (NEW v9)

Verdict variance and rationale similarity together can mask **rubber-stamp correlation** — five fresh calls returning `reject` with similar-sounding but *confabulated* rationales would look like a healthy asymmetry by those two metrics alone. The pathology: same verdict, similar prose, none of which point at the real defect. v9 adds a deterministic third axis that catches this.

**Citation precision**, scored by structural parse of `file:line` references in the Verifier's rationale + `evidence.focal_claim.lines` against the fixture's seeded `ground_truth_defect_loc`:

| Score | Definition |
|---|---|
| `aligned` | Rationale cites within ±2 lines of the seeded defect AND the correct file |
| `adjacent` | Same file but >2 lines off, OR a directly-imported file (1-hop from the defect file) |
| `unaligned` | Wrong location, OR no `file:line` citation present at all (which is its own actionable signal — the Verifier prompt isn't producing structured rationale) |

**Computation method.** Structural parse, **no LLM-judge**. We deliberately avoid an LLM call here — using another LLM to evaluate the Verifier would re-introduce the very correlation we're trying to detect. The audit harness:

1. Reads `evidence.focal_claim.lines` from the Verifier verdict (already in App. A.4 schema).
2. Regex-extracts `file:line` patterns from `rationale` and `aggregate_rationale` (`(\S+\.(ts|tsx|js|py|go|rs)):(\d+)`).
3. Each seeded-bad fixture YAML carries a `ground_truth_defect_loc: {file, line}` (NEW Sprint 9 fixture requirement).
4. Score is a deterministic three-way comparison.

**Pass criteria for known-bad audit set:**

- ≥80% of fixtures show ≥4-of-5 calls `aligned`.
- ≤5% of fixtures show 5-of-5 `unaligned` (the "all citing nowhere" failure).

**Failure-interpretation table:**

| Variance | Rationale similarity | Citation precision | Diagnosis |
|---|---|---|---|
| Low | High | High (`aligned`) | **Healthy asymmetry** — converges on the real defect |
| Low | High | Low (`unaligned`) | **Rubber-stamp risk** — converges via shared bias, not shared correctness. Action: re-author Verifier prompt; consider frontier-tier Verifier in v1.x. |
| High | Low | Mixed | Model is unreliable — reconsider model selection per §7.1 |
| Low on good, High on bad | (any) | (any) | Verifier accepts everything (rubber-stamp toward accept). Highest-severity finding |
| Low everywhere incl. controversial | (any) | (any) | Verifier is deterministic but "fresh" framing is functionally meaningless |

The diagnostic insight is the **High-similarity × Low-precision quadrant** — that's the operational signature of correlated sympathy bias.

**Continuous calibration via organic confirmation data.** The N=2 long-cycle confirmation pass (§6.5) generates organic 3-way samples on every production reject — `confirmation_of_trace_id` lets the audit aggregate confirmation pass data into the standing audit dataset. Treat as a separate cohort from curated fixtures (selection bias toward fixtures-where-first-call-rejected) — but a continuous calibration signal beyond the Sprint 9 baseline.

---

## Chapter 8: What This Doesn't Do (Yet)

### 8.1 Multi-framework coexistence

v9 assumes Dusk is the only orchestration framework in a project. Coexistence with OpenSpec or other code-authoring frameworks is deferred. Trigger to revisit: explicit project request with a clear lifecycle interleaving story.

### 8.2 Legacy codebase bootstrap

v9 assumes decorate-at-authorship. Bootstrap (one-time decoration of >20kLOC existing code) is a deferred guided workflow. **The new completeness rule (Ch. 4.1) makes bootstrap heavier than in v8** — every statement, not just every declaration, needs decoration. Trigger: first concrete adoption on a large pre-existing codebase.

**The inverse — greenfield — is v9's native mode, and it is the first post-v1 thesis *validation*** (its prerequisite, universal decoration coverage, is the first v1.x *change* — the POC is the first thing that *validates the thesis*, not the first change to land). Because decoration happens at authorship, a codebase born through Dusk is total-decorated by construction and never pays the bootstrap cost. The **Greenfield POC** (roadmap Sprint 11, implementation-plan Phase 6) builds a small real API application from `git init` with zero hand-written application code, validating the thesis on this native terrain before any legacy-bootstrap investment is made — restarting once its prerequisite, **universal decoration coverage (D.28)**, has landed (the first v1.x change; what makes the POC's comment-less files coverable). (App. D.23, D.28.)

**Greenfield has no "bootstrap" of its own — its foundation is just its first intents.** Bootstrap (above) is the *legacy* one-time decoration of pre-existing code. Greenfield has no pre-existing code, so it has nothing to retro-decorate; what a fresh project *does* need — project/module + tech-stack setup, app bootstrap, persistence layer, error/response conventions — is **the real first sequence of intents the author writes**, produced through `dusk_author` + `dusk_implement` like any other intent (App. D.24). There is deliberately **no orchestration "bootstrap" phase** (no synthesized foundation bead, no special bootstrap spawn, no canonical foundation Blocks) — that would couple the pipeline to a concept the intent tree already expresses and would ossify into a framework. Instead the **Author dialog** is responsible for noticing when a requested behavior intent presupposes foundational intents/decisions not yet authored, and steering the author to write those first (App. D.25; Ch. 5). The greenfield POC's first surfaced friction was exactly this: an endpoint intent authored before its foundation existed forced one bead to birth the whole app. The fix is authoring discipline enforced by the dialog agent, not a pipeline special-case.

### 8.3 Exhaustive verification mode

Shuffle sharding gives statistical confidence, not certainty. For security-critical / regulated constraints, a per-intent `verification: exhaustive` flag would bypass sampling. Deferred to v1.1.

### 8.4 Heterogeneous sub-agent models

v1 uses one model for all roles. Different roles on different models (Engineer on a more creative model, Verifier on a more rigorous one, Test Runner on a cheaper model for the verdict computation step) is deferred to v1.x. Trigger: benchmark data showing systematic same-model weaknesses by role.

### 8.5 Curated vocabulary as SSoT

Deferred. Trigger: explicit project request accepting the authoring tax.

### 8.6 Parallelism beyond worktrees

Within a single bead, the Engineer is one persistent agent. Multiple Engineers competing / multiple Verifiers consensus-voting is deferred.

### 8.7 Long-running Orchestrator → state-machine split

v1 ships single long-running stateful Root Orchestrator. v1.x may split into a state-machine with per-step short-lived agents for token economy.

### 8.8 Test runner heterogeneity (new in v9)

v1 ships with the Test Runner configured for one test runner per project (Vitest in this repo). Multi-runner support (Vitest for TS, pytest for Python, go test for Go) in a single monorepo is deferred to v1.x. Trigger: first polyglot adoption.

### 8.9 Beyond-PreToolUse static analysis (new in v9)

The 10 PreToolUse checks (§4.6; 12 typed rejection kinds) are mechanical and run per write. Three deeper checks live in `/dusk-doctor` (out-of-band):

- **Decorate-or-decompose static analysis (REPROMOTED to v1, Sprint 9).** The `S ⊆ D` mandate from §4.5 needs offline enforcement to catch decoration erosion over time. Originally deferred to v1.x; reviewer feedback pulled it back. Mechanically: build call-graph + decorator lookup, compute `S` (intent participations of called sub-operations) and `D` (intent set in unit's decorators) per decorated unit, flag where `S ⊄ D`. Run weekly during dogfooding; framed as **drift detection**, not real-time enforcement. Surface erosion trends as actionable signal — decoration density per package, decorate-or-decompose violation count over time.
- **Cross-bead claim overlap detection (NEW v9 — preventive, Sprint 5).** "No two beads have overlapping focal claims for the same aspect" is moved from v1.x deferred into Sprint 5 as a **Decomposer-time precondition**, not a post-hoc check. Decomposer refuses to issue a bead DAG where two beads would write conflicting focal claims; the conflict is reported back as a request for the Author to disambiguate the intents.
- **Per-intent claim minimum** ("every intent has at least one focal claimant"). Project-wide consistency check. v1.x.

### 8.10 Author search beyond grep (new in v9)

v1's Author Stage 2 (Discovery & Tension Detection) uses agent-driven grep / ripgrep / shell tools over `.ia/intents/` plus 1-hop `relates_to` expansion. **Semantic / vector / RAG search is not in v1.** When the intent index grows past the point where textual search misses meaningful overlap, the Author gains a semantic-search skill in v1.x. The substrate would be added as an opt-in addition under `packages/runtime/author/embeddings/` — not as a general-purpose embedding service. Trigger: first project reporting recurrent missed tensions in Stage 2.

### 8.11 Canonical intent / block library (new in v9)

v1 does **not** ship a runtime-fetched canonical intent library. Author Stage 3 (Industry-Practice Injection) applies best practices from the Author's training + role skill, plus search over the project's prior intents. Curated, versioned, shareable intent libraries that projects can import are deferred to the registry ecosystem in Sprint 10+ and the v1.x ecosystem deliverables. The `packages/intents/canonical/` directory, when present, contains documentation examples — not runtime lookup content.

---

## Chapter 9: Sub-Agent Architecture

Dusk defines **nine standard sub-agent roles**. Each has a documented prompt template, a strict tool scope, a defined memory model, and an optional skill set. The role definitions ship with Dusk and are installed into the project via `dusk init` to `.claude/agents/`:

```
.claude/agents/
├── dusk-root.md
├── dusk-bead.md
├── dusk-decomposer.md
├── dusk-scout.md
├── dusk-engineer.md
├── dusk-verifier.md
├── dusk-test-runner.md       # new in v9
├── dusk-author.md
└── dusk-conflict-resolver.md
```

### 9.1 The role table

| # | Role | Tier | Memory | Tool scope | Spawned by |
|---|---|---|---|---|---|
| 1 | **Root Orchestrator** | Coordinator | session | Spawn sub-agents; read status; no direct file access | Harness `dusk_implement` / `dusk_author` |
| 2 | **Bead Orchestrator** | Coordinator | bead | Spawn workers; manage one worktree; trigger commit | Root, one per bead |
| 3 | **Decomposer** | Worker | none | Read intents, index, codebase; no writes | Root, once per request |
| 4 | **Scout** | Worker | none | Read files, grep, AST query; no writes; no Bash | Any orchestrator or Engineer needing exploration |
| 5 | **Engineer** | Worker | **bead** | Write/Edit (PreToolUse-gated), Read, scoped Bash | Bead Orchestrator, one per bead |
| 6 | **Verifier** | Worker | **none** (fresh per call) | Read only | Bead Orchestrator (short-cycle + long-cycle) |
| 7 | **Test Runner** | Worker | bead | Read, Bash(test-runner-cmd only) | Bead Orchestrator, after long-cycle pass |
| 8 | **Author** | Worker | dialog | Authoring tools, Read | Root, or Decomposer when new intents needed |
| 9 | **Conflict Resolver** | Worker | none | Git ops, Read, Write | Bead Orchestrator / Root at worktree-merge time |

### 9.2 The Engineer ⊥ Verifier asymmetry

The most important design call is the persistence asymmetry between Engineer and Verifier.

**Engineer is persistent per bead** (memory: bead). It accumulates context across iterations — what it tried, what the Verifier said, what alternative it's exploring. This is creative-iterative work; resetting context every iteration would force the Engineer to re-derive its mental model wastefully.

**Verifier is fresh per call** (memory: none). No memory of prior iterations. Each iteration's diff is its own evidence. Persistent Verifier context would re-introduce confirmation bias — sympathy for the Engineer's effort, "this is close enough" judgments, gradual standard erosion.

The asymmetry mirrors how good code review works: the author lives with the change; the reviewer sees it clean.

**v9 makes the memory configuration explicit in the role frontmatter** (Ch. 9.5), not implicit in the prompt template. The runtime spawns the sub-agent with the declared memory configuration; the Verifier cannot accidentally accrue context across invocations.

### 9.3 Verifier shared between short and long cycles

The Verifier role is the same in both short-cycle pair programming and long-cycle shuffle sampling. Same prompt template, tool scope, output schema. What differs is the call site and input payload:

- **Short-cycle invocation:** input is `{intent, triples, diff_just_produced, focal_claimants, support_claimants, prior_verdict_if_iterating}`.
- **Long-cycle invocation:** input is `{intent, triples, sampled_existing_code, focal_claimants, support_claimants}`.

Output schema same in both cases. The `focal_claimants` and `support_claimants` fields (new in v9) are the scoped evidence set per Ch. 3.3.

### 9.4 Tool scoping (advisory in v1; hardening deferred to v1.x)

**Honest v1 stance.** The role-frontmatter `tools:` field declares what each sub-agent *should* use. Claude Code today does not provide hard sandboxing on agent-level tool scopes — the harness honors the declared list as an advisory bias, not a containment boundary. v1 ships with this looser model.

Concretely in v1:
- The Verifier's role prompt + frontmatter declare `tools: [Read]`. If a misbehaving Verifier issues a Write, the PreToolUse gate (Ch. 4.6) still runs its 10 mechanical checks on the diff — so misbehavior is bounded even without spawn-time tool sandboxing.
- The Engineer's `tools: [Read, Write, Edit, Bash(<scoped>)]` is advisory. The Engineer is instructed (in its role prompt + skills) to use only the listed tools.
- The Test Runner's `tools: [Read, Bash(<test-runner-cmd>)]` is advisory.

**What does enforce safety in v1:**
1. **PreToolUse gate** (Ch. 4.6) — every write is intercepted regardless of which sub-agent issued it.
2. **Pipeline structure** — Engineer's writes are gated; Verifier's outputs are verdict objects, not file mutations; commits are issued by the Bead Orchestrator, not the Engineer.
3. **Trace observability** — any sub-agent that uses a tool outside its declared scope shows up in the trace stream with `role` mismatched to actual tool usage, surfacing the violation post-hoc.

**v1.x hardening path.** When/if Claude Code adds spawn-time tool-scope enforcement, or when Dusk is willing to take on its own sub-agent runtime (Anthropic SDK + child process management), the role-frontmatter `tools:` field becomes a hard contract. v1 ships with the advisory model because it works with Claude Code's actual public capabilities today.

### 9.5 Role definition file format (updated for v9)

Each `.claude/agents/dusk-<role>.md` contains:

```markdown
---
dusk_role_version: 2
name: dusk-verifier
description: Verifies code against an intent's triples. Fresh context per call.
tools: [Read]
memory: none
skills: [dusk/verifier/triple-evaluation, dusk/verifier/code-span-scoping]
model: claude-sonnet-4-6
---

# Dusk Verifier

You are a Dusk Verifier sub-agent. Your job is to evaluate whether the provided
code satisfies a specific intent's triples...

## Input contract
{...}

## Output contract
{...}

## Evaluation procedure
{...}
```

The frontmatter declares:
- `dusk_role_version` — for compatibility checking (incremented to 2 in v9 to signal memory + skills fields)
- `tools` — tool scope
- `memory` — one of `none`, `bead`, `dialog`, `session` (new in v9)
- `skills` — list of registered skills under `.claude/skills/dusk/<role>/` (new in v9)
- `model` — default model, overridable

The body is the system prompt. Versioning the role file lets us evolve prompts cleanly — Dusk's runtime refuses to spawn a role whose `dusk_role_version` is outside the supported range.

### 9.6 Sub-agent memory model (new in v9)

Memory is the structural mechanism behind the pair-programming asymmetry. The four memory scopes:

| Scope | Semantics |
|---|---|
| `none` | Fresh context per invocation. No persistence across calls within the session. Used for: Verifier, Decomposer, Scout, Conflict Resolver. |
| `bead` | Context persists within a single bead's lifecycle (across short-cycle iterations, long-cycle samples, and test-execution feedback). Used for: Engineer, Test Runner, Bead Orchestrator. |
| `dialog` | Context persists across a multi-turn user dialog (e.g., the intent authoring flow). Used for: Author. |
| `session` | Context persists across the entire Dusk session (root → all beads → merge). Used for: Root Orchestrator. |

The runtime materializes memory at spawn time by constructing the sub-agent's initial context from the named scope's persistent state. When a sub-agent finishes a call, the runtime writes its output back to the scope (for `bead`/`dialog`/`session`) or discards it (for `none`).

For roles with `memory: bead`, the Bead Orchestrator maintains a per-bead memory file at `.ia/runtime/beads/<bead-id>/<role>.md` that's loaded as initial context for each invocation within the bead and updated on each return. The file is destroyed when the bead completes.

For `memory: none`, the runtime explicitly constructs the sub-agent's input solely from the spawn payload — no prior-state file is loaded. (See §7.5 for the fresh-Verifier audit that makes behavioral freshness falsifiable, not just app-layer enforced.)

#### 9.6.1 Bead memory file format — structured + dual-channel (NEW v9)

Reviewer feedback identified that an append-only iteration transcript would cause the Engineer's later iterations to anchor on accumulated rationalization. v9 specifies bead memory as **structured**, not transcript, with a **dual-channel** division between impl authoring and test authoring (each has different failure shapes and feeds different escalation paths per §3.4.1):

```markdown
---
bead_id: bd_2026052600001
role: engineer
last_iter: 7
---

## Current diagnosis
<Written by Engineer when the §6.4.2 stuckness detector fires OR at iter 5
 (whichever comes first), refreshed each iter thereafter. Names the
 specific blocker: which triple keeps failing and why, whether the intent
 appears unsatisfiable as stated, whether attempts have been structurally
 distinct.>

## Approaches tried (impl)
- [iter 1-3] Approach A — extracted helper into module X, decorated @intent Y.
  Verifier rejected: <one-line rationale>.
  Triple-slot focus: predicate
- [iter 4-6] Approach B — restructured to flatten control flow.
  Verifier rejected: <one-line rationale>.
  Triple-slot focus: object

## Approaches tried (test-authoring)
<Only present when the bead is in the two-stage test-satisfaction path (§3.4).
 Structural test-approach identifier from the dusk/engineer/test-approach-taxonomy
 controlled vocabulary: mock-call-order, time-spy, state-observation,
 snapshot-of-events, instrumented-mock, dependency-injection-stub, …>
- [iter 1-2] Approach: mock-call-order. Used vi.fn().mock.invocationCallOrder.
  Verifier rejected: triple required ordering between db.insert and pubsub.publish;
  test asserted only that both were called. Triple-slot focus: predicate.
- [iter 3-4] Approach: time-spy. Added explicit Date.now() spies.
  Verifier rejected: triple does not assert temporal ordering, asserts call-graph.
  Triple-slot focus: predicate.

## Verifier signals (last 3 verdicts; older verdicts compacted into "Approaches tried")
- [iter 7] reject — failing triple: <intent_path>[<aspect>] "subject predicate object".
  Polarity: positive. focal_verdict: fail. support_quality: ok.
  Evidence quote: <50-char excerpt>.

## Intent set in scope
- <intent_path> [<aspect>, ...]
- ...

## Files being modified
- <file_path>
- ...
```

**Compaction rule.** Mechanical/templated only — **never LLM-summarized**. When more than 3 Verifier-signal entries exist, the runtime collapses entries older than the last 3 into the relevant "Approaches tried" rolling summary. Compaction preserves structured facts (triple_id, focal_verdict, support_quality, evidence quote, approach label, slot focus); it drops only verbose rationale text. Done by the Bead Orchestrator on write-back, deterministically. The Engineer never authors compaction.

**Why structured + dual-channel:**

1. A code reviewer (the §9.2 metaphor) doesn't see the author's internal monologue. Memory mirrors what's useful for the next attempt, not the thinking during prior attempts.
2. Bounded file size keeps Engineer context predictable across iterations (iter 15 reads a similarly-sized file as iter 3).
3. The "Current diagnosis" section is consumed by the **Bead Orchestrator** for routing decisions (recovery ladder §6.4.1, livelock detection §3.4.1, early escalation §6.4) — it does NOT enter the Verifier's spawn payload. The Verifier remains genuinely fresh-per-call. The §7.5 audit benchmark validates this empirically.
4. Dual-channel separation surfaces categorical failure-mode differences — impl-rejection rationales tend to be evidence-grounded; test-authoring rejections tend to be assertion-grounded. Conflating both in one log loses the distinction the orchestrator needs for routing.
5. `Triple-slot focus` per approach (deterministic keyword classifier over the §3.1.1 lexicon — no LLM call) drives the §3.4.1 livelock-escalation-routing decision tree.

### 9.7 Sub-agent skills (new in v9)

Skills are role-bound extensions to a sub-agent's prompt and tool repertoire. They live at `.claude/skills/dusk/<role>/<skill-name>.md` and follow the harness's existing skill format.

```
.claude/skills/dusk/
├── engineer/
│   ├── decoration-completeness.md       # how to ensure every statement has decoration
│   ├── statement-extraction.md          # how to extract nested function calls
│   ├── support-triple-authoring.md      # how to write good NL triples
│   └── drizzle-extraction.md            # domain-specific: how to handle Drizzle builders
├── verifier/
│   ├── triple-evaluation.md             # how to evaluate a triple against code
│   └── code-span-scoping.md             # how to use focal+support claims to scope reading
├── test-runner/
│   └── vitest-invocation.md             # how to invoke vitest with scoped file lists
├── author/
│   ├── tension-detection.md             # how to identify intent conflicts
│   └── test-pyramid-proposal.md         # how to propose test-pyramid children
├── decomposer/
│   └── bead-dag-construction.md         # how to build the bead dependency DAG
└── conflict-resolver/
    └── decorator-aware-merge.md         # how to merge conflicts on decorated code
```

**Skills are organized by role (advisory in v1).** The directory layout `dusk/<role>/<skill>` reflects which skill is *meant for* which role. The Author role prompt instructs it to load `dusk/author/*` skills; the Engineer's prompt instructs it to load `dusk/engineer/*`. v1 does NOT hard-enforce that the Engineer cannot load a Verifier skill — Claude Code's skill system does not provide role-scoped discovery natively.

In practice:
- The role prompt names exactly which skills the role should consider in scope (the `skills:` frontmatter list).
- The runtime injects those skills' content into the spawn payload as part of the system prompt.
- A misbehaving role could in principle reach for unscoped skills via grep, but the role-prompt instruction + the trace stream's `skill_loaded` events catch this post-hoc.

**Skills as the extension point for domain-specific authoring patterns.** A project that uses GraphQL might add `.claude/skills/dusk/engineer/graphql-resolver-extraction.md` teaching the Engineer how to extract nested resolver calls per the code-style rule. A project that uses Effect-TS might add `.claude/skills/dusk/engineer/effect-pipeline-decoration.md`.

The shipped baseline skills cover the framework's invariants (decoration completeness, statement extraction, etc.). Project-specific skills are added during `dusk init` or by editing the project's `.claude/skills/dusk/` tree.

### 9.8 Per-project customization

Projects can override role definitions per-project by editing the `.claude/agents/dusk-<role>.md` files. Common customizations:

- Add team-specific addenda to the system prompt
- Pin a specific model per role
- Register additional skills
- Adjust the tool scope (rarely — only loosen carefully)

Customizations track in git. Dusk's `/dusk-doctor` slash command (Ch. 10.2) detects role definitions that have drifted incompatibly from the shipped baseline; validates intent files, derived-index integrity, and decoration completeness across the project.

### 9.9 Sub-agent spawn mechanism (NEW v9 — answered, not assumed)

v9 specifies the concrete mechanism used to spawn sub-agents — a question reviewer feedback flagged as unanswered in earlier drafts.

**In v1, Dusk uses Claude Code's Task tool with `subagent_type: dusk-<role>` to spawn each sub-agent.** This is the public-facing Claude Code primitive for sub-agent invocation; it matches role files by name (`.claude/agents/dusk-<role>.md`) and hands the role its system prompt + tools as declared in frontmatter.

The full spawn flow:

```
1. Bead Orchestrator decides to spawn role R (e.g., the Engineer).
2. Memory materialization (Dusk-owned, before the spawn call):
   - For memory: bead — read .ia/runtime/beads/<bead-id>/<role>.md into a
     context block ("PRIOR BEAD STATE").
   - For memory: dialog — read .ia/runtime/dialogs/<dialog-id>/<role>.md.
   - For memory: session — read .ia/runtime/session/<role>.md.
   - For memory: none — produce an empty context block.
3. Skill injection (Dusk-owned):
   - For each skill in the role's frontmatter `skills:` list, read
     .claude/skills/dusk/<role>/<skill>.md and append to the context.
4. Spawn payload:
   - subagent_type: dusk-<role>
   - prompt: <role description> + <input contract instance> +
             <prior bead state> + <injected skills> + <step-specific context>
5. Task tool is called with the spawn payload.
6. On return:
   - For memory: bead/dialog/session — Dusk writes the role's output (or a
     structured summary of it) back to the memory file per the
     compaction strategy in §9.6.1.
   - For memory: none — output is discarded after the verdict is consumed.
   - SubAgentTrace event emitted to .ia/observability/traces.jsonl.
```

**Memory materialization happens before the Task tool call, not as part of the Task primitive.** Claude Code's Task tool does not natively understand "load this file as initial context" — Dusk constructs the full system prompt including any prior memory, then hands the assembled prompt to Task as a single string. Same for skills injection.

**Why this works for v1:**
- Uses a real, documented Claude Code primitive (Task with `subagent_type`).
- The memory-scope model is Dusk's own abstraction layered on top — the harness doesn't need to know about it.
- Skills are read from disk by Dusk at spawn time, injected as system-prompt content — no harness-level scoping required.
- Tool-scope is advisory (per §9.4); the role file's `tools:` field is honored by Claude Code as configuration, not as a hard sandbox.

**Trade-offs accepted:**
- No hard sandbox — Dusk cannot prevent a misbehaving Verifier from issuing a Write. Mitigated by PreToolUse gate (any write is intercepted) + post-hoc trace inspection.
- All sub-agents share the harness session — Claude Code allocates context globally per session. Long-running pipelines may hit session-level context pressure; v1 ships with a hard 20-iteration short-cycle cap to bound this.
- Memory materialization adds I/O latency per spawn (~50-200ms on local disk). Acceptable for v1; could be cached/in-memory in v1.x.

**v1.x evolution path.** If Dusk needs hard tool-scope, true memory isolation, or session-independent sub-agent runtime, the alternatives are: (a) Dusk takes ownership of the sub-agent runtime via direct Anthropic SDK calls + child process management; (b) Dusk uses scoped `claude` CLI subprocess invocations per role; (c) wait for Claude Code to add the primitive natively. None of these is required for v1.

---

## Chapter 10: The Integration Surface

### 10.1 MCP tools

Dusk runs as an MCP server. The primary tools:

| Tool | Purpose | Input | Output |
|---|---|---|---|
| `dusk_implement` | Run the full 9-step pipeline OR resume a paused run | `{ request?: string, resume_token?: string, scope_hint?: string[] }` (exactly one of `request` or `resume_token` required) | `{ commits[], beads_summary[], intents_touched[], test_intents_executed[], trace_ids[], total_duration_ms, total_cost_usd } \| DuskError` |
| `dusk_author_start` | Begin the intent authoring sub-flow | `{ request: string }` | `{ dialog_id: string, stage: 1\|...\|5, next_question: string, options?: string[] } \| DuskError` |
| `dusk_author_continue` | Continue an in-flight authoring dialog | `{ dialog_id: string, response: string }` | `{ stage: 1\|...\|5, next_question?: string, options?: string[], finalized?: false } \| DuskError` |
| `dusk_author_finalize` | Commit authored intents at end of Stage 5 | `{ dialog_id: string }` | `{ intents_created[], test_pyramid_children_created[], dialog_transcript_path: string } \| DuskError` |
| `dusk_resolve_livelock` | Resolve a test-Verifier livelock (§3.4.1) | `{ bead_id: string, verb: "accept_test_as_is" \| "modify_triple" \| "escalate", payload?: object }` | `{ resumed: boolean, action_taken: string } \| DuskError` |
| `dusk_status` | Current state (active beads, recent commits, index summary) | `{}` | `{ active_beads[], recent_verdicts[], recent_test_runs[], index_stats } \| DuskError` |
| `dusk_inspect` | Read-only query against intents / decorators / index | `{ scope: string \| string[] }` | `{ intents[], claims[], support_claims[], aspects_unsatisfied[], test_intents[] } \| DuskError` |
| `dusk_verify` | Ad-hoc verification of a diff outside the pipeline | `{ diff: Diff, intents?: string[] }` | `Verdict \| DuskError` |
| `dusk_cancel` | Cooperative abort of an in-flight pipeline run | `{ bead_id?: string, reason: string }` | `CancelResult \| DuskError` |
| `dusk_list_intents` | Paired read-only fallback for `dusk://intents` resource | `{}` | `{ intents: [{path, description, obligation}, ...] }` |
| `dusk_get_intent` | Paired read-only fallback for `dusk://intents/<path>` resource | `{ path: string }` | Intent yaml content |
| `dusk_list_traces` | Paired read-only fallback for `dusk://traces/recent` resource | `{ limit?: number, since?: string }` | `{ traces: SubAgentTrace[] }` |
| `dusk_list_beads` | Paired read-only fallback for `dusk://beads/active` resource | `{}` | `{ beads: [{id, status, current_step, started_at}, ...] }` |
| `dusk_get_bead` | Paired read-only fallback for `dusk://beads/<bead-id>` resource | `{ bead_id: string }` | `{ id, status, current_step, memory_summary, verdict_history }` |
| `dusk_list_implement_checkpoints` | Outstanding paused-pipeline checkpoints (§10.1.1) | `{}` | `{ checkpoints: [{resume_token, original_request, created_at, last_touched_at, unresolved_refs}, ...] }` |

**`dusk_author` is split into three MCP calls (NEW v9).** Earlier drafts modeled the 5-stage interactive flow as a single `dusk_author` call returning a `dialog_transcript`. Reviewer feedback identified that MCP's call/response shape can't drive a multi-turn dialog — each user response needs its own call. The continuation pattern (`start → continue × N → finalize`) maps naturally onto MCP semantics: the harness calls `dusk_author_continue` once per user response, until `finalized: true`. The `dialog_id` is the session token; state persists in `.ia/runtime/dialogs/<dialog-id>/` between calls.

**Error envelope (`DuskError`).** Every MCP tool returns either its success shape OR a structured error. See App. A.11 for the union schema.

**MCP resources + paired tools (NEW v9).** Dusk exposes MCP resources for native host-side discovery, AND ships a paired read-only MCP tool for each resource as a fallback. Hosts that support MCP resource browsing (e.g., evolving Cursor / Claude Agent SDK surfaces) use resources for cheap browsing. Hosts that don't (Claude Code at v1 ship time has minimal resource-browsing) call the tools. Both surfaces read the same in-memory derived index — no behavioral drift.

| Resource URI | Paired tool | Content |
|---|---|---|
| `dusk://intents` | `dusk_list_intents` | All intents (path, description, obligation) |
| `dusk://intents/<path>` | `dusk_get_intent` | One intent.yaml |
| `dusk://traces/recent` | `dusk_list_traces` | Last N trace events |
| `dusk://beads/active` | `dusk_list_beads` | Active bead summaries |
| `dusk://beads/<bead-id>` | `dusk_get_bead` | Bead memory + verdict history |
| `dusk://implement-checkpoints` | `dusk_list_implement_checkpoints` | Outstanding paused-pipeline checkpoints (§10.1.1) |

The CLAUDE.md carries one advisory instruction:

> In this project, prefer routing code-authoring work through `dusk_implement` to get the pipeline's correctness guarantees (decoration completeness, regression detection, test execution). Direct Write/Edit calls bypass these guarantees but are not blocked — the PreToolUse gate still enforces decoration mechanically on any write. To author new intents, use `dusk_author_*`.

**Honest framing (v1).** The instruction is advisory, not a hard contract. The PreToolUse gate enforces the decoration mandate on every write regardless of who issues it — so direct Write/Edit calls produce decorated code but don't get the pipeline's regression/test guarantees. v1.x may add a workspace marker that the gate uses to require pipeline-origin for some classes of writes; v1 ships with the advisory model.

### 10.1.1 The pause/resume contract for unresolved intents (NEW v9)

`dusk_implement` is a single MCP request — it cannot block while the harness drives a multi-turn `dusk_author_*` dialog. When the Decomposer at Step 1 encounters an unresolved intent reference, Dusk writes a **disk checkpoint** (Dusk-owned state file, NOT in-memory pipeline state), returns a `DuskError` with `resume_token`, and exits cleanly. The harness drives the authoring dialog, then re-calls `dusk_implement({resume_token})` to resume from the checkpoint.

**Why disk checkpoint, not in-memory linkage:** the pipeline state must outlive the MCP request that paused it AND survive harness crashes / process restarts / arbitrarily long user interactions. The disk-resident pattern mirrors bead memory (§9.6) and dialog memory (§5).

**`resume_token` format:** `rt_<14-digit-yyyymmddhhmmss><3-digit-seq>` (same shape as bead/verdict/trace ids per App. D.8 for sortability).

**Checkpoint file:** `.ia/runtime/implement/<resume_token>.json` carrying `{original_request, scope_hint, decomposer_partial_state, intents_resolved_so_far, intents_still_unresolved, created_at, last_touched_at}`.

**Lifetime:** 24h since `last_touched_at` (matches Author dialog GC window). `dusk doctor --gc-implement-checkpoints` collects stale ones. Single-use: on successful resume, the checkpoint file is deleted at the same point the pipeline transitions out of Step 1.

**Harness call sequence:**

1. Harness calls `dusk_implement({request, scope_hint?})`.
2. Decomposer hits unresolved intent → Dusk writes checkpoint → returns:
   ```
   DuskError{
     kind: "implement_paused_for_authoring",
     details: { resume_token, suggested_dialog_seed, unresolved_refs[] },
     recoverable: true,
     recovery_hint: "Call dusk_author_start({request: details.suggested_dialog_seed});
                     on dusk_author_finalize, call dusk_implement({resume_token}) to resume."
   }
   ```
3. Harness reads `recovery_hint`, calls `dusk_author_start({request: suggested_dialog_seed})`.
4. Harness loops `dusk_author_continue` over user turns until `finalized: true`.
5. Harness calls `dusk_author_finalize({dialog_id})` → intents committed, dialog directory destroyed.
6. Harness calls `dusk_implement({resume_token})` (no `request` field — Dusk reads from checkpoint). Decomposer reloads partial state, re-runs unresolved-ref check, continues to Step 2.

**Abandonment handling:**

- User abandons mid-dialog → `dusk doctor --gc-dialogs` reaps after 24h; checkpoint reaped by `--gc-implement-checkpoints` on the same window.
- User abandons after finalize but before resume → checkpoint persists until 24h expiry. Harness can list outstanding checkpoints via `dusk_list_implement_checkpoints` / `dusk://implement-checkpoints`.
- Expired `resume_token` → returns `DuskError{kind: "implement_resume_token_expired", recoverable: false, recovery_hint: "Original request was: <...>. Re-run dusk_implement({request: ...})"}`. Original request is preserved in the checkpoint specifically so the recovery hint is actionable.
- Concurrent runs OK — multiple checkpoints can be outstanding; the trace stream distinguishes by `trace_id`.

### 10.1.2 The `dusk_cancel` cooperative-cancellation contract (NEW v9)

`dusk_cancel` requests **cooperative cancellation** — it is NOT a kill signal. Claude Code's Task tool has no documented abort primitive, so once a Task call is in-flight Dusk must wait for it to return. `dusk_cancel` sets a cancellation flag, drains active Task calls to natural completion, then runs an idempotent cleanup pass.

**Cleanup ordering:**

1. Set flag on target (`{bead_id}`-scoped or session-wide if `bead_id` omitted). New Task spawns are short-circuited at the Orchestrator's next loop tick.
2. Wait for currently-in-flight Task calls to return (no synthetic timeout). Their outputs are received and discarded. Trace events record `cancelled_during_task: true`.
3. Cleanup pass:
   - **Dialogs.** `.ia/runtime/dialogs/<dialog-id>/` destroyed for any open Author dialogs scoped to the cancellation.
   - **Implement checkpoints.** `.ia/runtime/implement/<resume_token>.json` destroyed for any checkpoints associated with the cancellation.
   - **Bead memory.** `.ia/runtime/beads/<bead-id>/*` deleted for each cancelled bead.
   - **Worktrees with no commits.** `git worktree remove` + branch deleted. Reported as `cancelled_worktrees`.
   - **Worktrees with bead commits.** Worktree KEPT, branch KEPT, reported as `partial_commits` with branch name. User decides whether to merge or discard.
   - **Already-committed work.** Commits already on main are NOT touched. Reported as `already_committed` (informational).
   - **Trace stream.** Not cleaned — remains as historical record. The cancellation itself is traced.

**`CancelResult` schema:**

```typescript
type CancelResult = {
  schema_version: 1;
  cancelled: {
    beads_short_circuited: string[];
    cancelled_worktrees: string[];
    partial_commits: Array<{ bead_id; branch; commit_sha; merge_decision: "user_choose" }>;
    cancelled_dialogs: string[];
    cancelled_checkpoints: string[];
    bead_memories_deleted: string[];
  };
  preserved: {
    already_committed: Array<{ bead_id; commit_sha }>;
    in_flight_tasks_drained: number;
  };
  trace_id: string;
  drain_duration_ms: number;
};
```

**Why cooperative, not kill:** lying about abort capability would surface as "I told it to stop but it kept running" — the worst possible UX. Honest cooperative semantics + drain + ordered cleanup + return shape that distinguishes cleaned-up from preserved is strictly better than fake-aborting.

### 10.2 Slash commands (skills)

| Command | Purpose |
|---|---|
| `/dusk-init` | Initialize a new Dusk project |
| `/dusk-author` | Trigger intent authoring directly |
| `/dusk-status` | Show current state |
| `/dusk-verify` | Run verification on an arbitrary diff |
| `/dusk-test` | Run test execution against a scope (new in v9) |
| `/dusk-benchmark` | Run the model benchmark harness |
| `/dusk-doctor` | Validate role definitions, intent files, index integrity, decoration completeness |
| `/dusk-doctor --static-analysis` | Decorate-or-decompose (`S ⊆ D`) static analysis — drift detection over time (NEW v9, Sprint 9) |
| `/dusk-doctor --check-hook` | Verify PreToolUse hook is installed in `.claude/settings.json` correctly |

### 10.3 The harness contract

For Dusk to run, the host agent harness must provide four capabilities (the v1 list — revised down from five after reviewer feedback identified that scoped skill discovery was not a public harness capability):

1. **Sub-agent spawning by type with declarable tools + model.** Claude Code's Task tool (`subagent_type: <name>`) provides this. Tool-scope is advisory per §9.4.
2. **PreToolUse-style hook on file writes** — the harness must support a stdin/stdout hook that runs before file writes and can decide approve/block. Claude Code's `PreToolUse` hook provides this. Wire format in §4.6.1.
3. **MCP server hosting** — the harness must run an MCP server (Dusk's) and route tool calls + resources through it.
4. **File-system trace emission** — Dusk emits its traces by writing `.ia/observability/traces.jsonl` directly; the harness must allow file writes from the Dusk process. Optional sinks (PostHog, OTLP) are out-of-band file mirrors.

If a harness does not provide all four, Dusk does not run on it. v1 ships supporting Claude Code; other harnesses require adapter work not on the v1 roadmap.

**Dusk-owned responsibilities (NOT in the harness contract).** Capabilities that earlier drafts wrongly assigned to the harness, now correctly owned by Dusk:
- **Memory materialization.** Dusk reads/writes `.ia/runtime/beads/<bead-id>/<role>.md` before/after Task tool calls. The harness doesn't know about the memory model.
- **Skill injection.** Dusk reads `.claude/skills/dusk/<role>/<skill>.md` files at spawn time and injects content into the system prompt. The harness's skill discovery is not used for sub-agent skills.
- **Pipeline orchestration.** Dusk owns the 9-step state machine; the harness just hosts the MCP server and runs the hook.

### 10.4 Mutual exclusion with other orchestration frameworks

Dusk assumes it is the only code-authorship orchestration framework in a project. The CLAUDE.md instruction routing work to `dusk_implement` is exclusive. The architectural reason: pair-programming bias resistance, decorator gating, shuffle-sharding regression detection, **and test-execution completeness** all require Dusk to own the full path from request to commit. Coexistence stories belong to v1.x or v2.

---

## Appendix A: Reference Schemas

### A.1 `intent.yaml` (v9 schema, schema_version: 2)

```yaml
schema_version: 2                                # required — 2 for v9 schema
id: string                                       # required, slash-namespaced hierarchical path
description: string                              # required, free prose
obligation: must | should | may                  # required

# Composition operator.
# - all | any | none operate over `triples[]`.
# - implies splits into `antecedent[]` + `consequent[]` groups.
compose: all | any | none | implies              # optional, default "all"

# For compose: all | any | none — flat triples[] list:
triples:
  - id: string                                   # required, unique within this intent (clause id)
    subject: string                              # required, affirmative NL noun phrase
    predicate: string                            # required, affirmative verb phrase — parser rejects matrix-predicate negation per §3.1.1
    object: string                               # required, affirmative NL — constituent negation inside NPs is legal per §3.1.1
    polarity: positive | negative                # optional, default positive — structural negation (LLM never sees inversion)
    quantifier:                                  # optional, default existential (at-least-one)
      at-least-one | each | exactly-one | at-most-one | none | at-least-<N> | at-most-<N>
    scope: string                                # optional, free NL bound for the quantifier

# For compose: implies — antecedent + consequent groups (§3.2.1):
antecedent: [<triple>, ...]                      # required if compose: implies
  # Antecedent triples are restricted to a CLOSED predicate vocabulary:
  #   "is decorated with" | "claims any aspect of" | "is enclosed by a decoration of"
  # Object must be a resolvable index reference (intent-path, intent-path[clause-id], directory glob).
  # Parser rejects antecedent triples outside this grammar with decoration_parse_error.
  # Evaluated by deterministic index lookup at Verifier time — NEVER by LLM.
consequent: [<triple>, ...]                      # required if compose: implies
  # Same shape as `triples[]`; full NL freedom. LLM-evaluated only if antecedent holds.

# Typed relates_to (NEW v9 — five kinds in v1).
# `refines` was collapsed into `parent` (path hierarchy expresses narrowing implicitly).
relates_to:
  - kind: parent | implies | conflicts | supersedes | sibling
    target: <intent-path>
  - ...
```

**Negation model (NEW v9 — §3.1).** Subject/predicate/object slots are always affirmative English. Structural negation is expressed via `polarity: negative`. The runtime inverts the affirmative verdict post-LLM; the LLM never sees a negated question.

**Migration from v8 (`schema_version: 1`):**
- Loader reads v1 intents and emits deprecation warnings.
- Flat `relates_to: [string]` is parsed as `[{kind: sibling, target: <path>}]`.
- Early-v9-draft `kind: refines` entries load as `kind: parent`.
- Triples with `negated: true` (the old v8 flag) migrate to `polarity: negative` automatically.

### A.2 Decorator syntax in code

```
// @intent <intent-path> [<aspect-id>, ...]
//     declarations OR non-declaration statements/blocks; focal claim;
//     one intent per line; optional aspect list

// @intent-support <intent-path> [<aspect-id>, ...] [<subject>, <predicate>, <object>]
//     non-declaration statements/blocks only; supporting claim;
//     three-slot NL triple required; one intent per line

// @intent-test <intent-path> [<aspect-id>, ...]
//     test declarations; intent-path must end in /unit-tests, /integration-tests, or /e2e-tests

// @intent-test-file <intent-path>
//     at top of test file; intent-path must end in a test-pyramid suffix

// @intent-file <intent-path> [<aspect-id>, ...]
//     at top of file; focal claim at file scope

// @intent-ignore <intent-path> [<aspect-id>, ...] because=(<subject>, <predicate>, <object>) reason="..."
//     opt-out at any scope; BOTH because-triple AND reason required, one line
```

### A.3 `.intent` file format

```
# Comments use hash
@intent <intent-path> [<aspect-id>, ...]
@intent <intent-path>
# ...
```

One claim per line. Used for genuinely directory-level invariants only; cross-cutting concerns go on the touching functions (Ch. 4.3).

### A.4 Verifier output

```typescript
type Verdict = {
  intent_path: string;
  decision: "accept" | "reject";

  // For compose: implies intents only — antecedent evaluation result.
  // If false, consequents are not evaluated; per_triple is empty.
  implies_antecedent_held?: boolean;

  per_triple: {
    triple_id: string;

    // Split verdict (NEW v9):
    focal_verdict: "pass" | "fail";          // drives Engineer re-draft decision
    support_quality: "ok" | "low_confidence"; // diagnostic only; does NOT trigger re-draft

    // Polarity is preserved in the trace so post-hoc analyzers can audit the
    // inversion behavior. Runtime applies it AFTER LLM verdict.
    polarity: "positive" | "negative";

    evidence: {
      focal_claim?: { file: string; lines: [number, number]; quote: string };

      // Per-support-claim verdict (NEW v9):
      // matches  = NL triple accurately describes the statement
      // mismatch = NL triple claims something the statement doesn't do
      // vague    = NL triple too underspecified to verify
      support_claims: {
        file: string;
        lines: [number, number];
        quote: string;
        support_triple: [string, string, string];
        triple_verdict: "matches" | "mismatch" | "vague";
      }[];

      // By default only failed/low-confidence supports are enumerated in the
      // support_claims array. Passing supports are summarized as a count
      // to keep trace volume bounded. Use `dusk_inspect --verbose` for full
      // enumeration.
      support_pass_count?: number;
    };

    rationale: string;
  }[];

  aggregate_rationale: string;
};
```

**`support_quality` aggregation rule.** Computed from per-claim `triple_verdict` values: any `mismatch` → `low_confidence`; ≥50% `vague` → `low_confidence`; else `ok`.

### A.5 Test Runner output (new in v9)

```typescript
type TestVerdict = {
  test_intent_path: string;                  // e.g., "notifications/send/unit-tests"
  decision: "pass" | "fail";
  per_triple: {
    triple_id: string;
    verdict: "pass" | "fail";
    mapped_tests: { file: string; test_name: string; result: "pass" | "fail" | "skip"; duration_ms: number }[];
    rationale: string;
  }[];
  aggregate_rationale: string;
  test_runner_command: string;
  total_duration_ms: number;
};
```

### A.6 Sub-agent trace event

```typescript
type SubAgentTrace = {
  // Schema versioning (NEW v9)
  schema_version: 1;                             // bump when the trace schema evolves

  trace_id: string;
  bead_id?: string;
  parent_trace_id?: string;
  role:
    | "root-orchestrator" | "bead-orchestrator"
    | "decomposer" | "scout"
    | "engineer" | "verifier"
    | "test-runner"
    | "author" | "conflict-resolver";
  invocation_site:
    | "implement" | "author"
    | "short-cycle" | "long-cycle"
    | "test-execution" | "merge";

  // Resource metrics
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  cost_usd: number;
  input_summary?: object;
  output_summary?: object;

  // Verifier-only fields
  agreement_with_pair?: boolean;                 // long-cycle Verifiers vs short-cycle
  ground_truth?: "accept" | "reject";            // benchmark mode only

  // Test Runner fields
  test_runner_command?: string;
  test_pass_count?: number;
  test_fail_count?: number;

  // Index coherency (NEW v9 — §2.10)
  index_snapshot_id?: string;                    // hash of the session snapshot in use

  // Long-cycle confirmation pass (NEW v9 — §6.5)
  confirmation_of_trace_id?: string;             // present on confirmation calls; references the original reject
  confirmation_pass_outcome?:                    // present on the original call once confirmation completes
    | "confirmed_reject"                          // ≥1/2 confirmation calls agreed reject
    | "flaky_verdict_dismissed";                  // both confirmation calls overrode to accept

  // Stuck-bead debugging (NEW v9 — short-cycle traces only)
  iteration_number?: number;                     // 1..20 within a bead's short cycle
  verdict_delta_from_prior?: {                   // what changed vs prior iter's verdict
    flipped_triples: string[];                   // triple_ids that flipped pass↔fail
    new_failures: string[];                      // triple_ids failing for the first time
    new_passes: string[];                        // triple_ids passing for the first time
  };
  failing_triple_set?: string[];                 // triple_ids currently failing (for §6.4.2 stuckness detector)
  engineer_change_summary?: string;              // 1-2 sentence summary of what the
                                                 // Engineer changed since prior iter
                                                 // (extracted from bead memory diff)

  // Bead Orchestrator traces only — diagnosis lives here, NEVER in Verifier spawn payload
  convergence_diagnosis_present?: boolean;
  stuckness_detector_state?: {
    iter: number;
    fired: boolean;
    window_match: boolean;
    failing_triple_set_stable: boolean;
  };
  verifier_livelock_signal?: {                   // §3.4.1
    failing_triple: string;                      // e.g. "notifications/send/unit-tests[covers-persist-first]"
    slot_focus: "subject" | "predicate" | "object";
    structural_approach_count: number;           // count of distinct test-authoring approaches tried
  };

  // Skill usage (NEW v9 — for skill-scope post-hoc audit per §9.7)
  skills_loaded?: string[];                      // e.g. ["dusk/engineer/statement-extraction"]

  // Test/benchmark-mode raw-prompt capture (NEW — board round 4).
  // The verbatim assembled system prompt handed to the Task tool. Populated
  // ONLY in test/benchmark mode (cost-gated; production traces omit it). This
  // is the observable surface that makes the asymmetry/polarity/two-path
  // guarantees falsifiable: the no-diagnosis-leak check (§9.6.1), the
  // "LLM never sees negation" check (§3.1), and the consequent-only check for
  // compose: implies (§3.2.1) all assert against raw_prompt, not against the
  // lossy input_summary. The relevant invariant is STRUCTURAL ("no
  // iteration-specific or diagnosis content in the payload"), not byte-identity
  // across iterations — behavioral freshness is measured empirically by §7.5.
  raw_prompt?: string;
};
```

**Note on diagnosis routing.** `convergence_diagnosis_present` appears on **Bead Orchestrator** traces only. Verifier traces NEVER carry the diagnosis field, and a Verifier's `raw_prompt` (in test mode) contains **no iteration-specific or diagnosis content** — preserving the Engineer ⊥ Verifier asymmetry validated by §7.5. The earlier "spawn payload identical across iterations" framing is superseded by this structural no-leak property: byte-identity is both too strong (breaks on benign field reordering) and too weak (identical payloads can still yield correlated verdicts — which is exactly why §7.5's three-axis audit exists).

### A.7 Atomic commit format

```
<type>(<scope>): <subject line>

<optional body>

Intent: <intent-path> [<aspect-id>, ...]
Intent: <intent-path> [<aspect-id>, ...]
Test-Intent: <intent-path>/unit-tests
Test-Intent: <intent-path>/integration-tests
Bead-id: bd_<timestamp><seq>
Verdict-id: vd_<timestamp><seq>
Trace-id: tr_<timestamp><seq>
Verifier-model: <model-id>
Test-Runner-model: <model-id>
Long-cycle-samples: <count>
Test-Suites-passed: <count>
```

### A.8 PreToolUse rejection types

The 10 mechanical checks of §4.6 map onto the **12 typed rejection kinds** below (some checks emit more than one kind — see §4.6). Conformance testing is per-kind: one fixture per kind.

> **v1.x extension (D.28 — universal-decoration-coverage).** When that change lands it adds **5 gate-only coverage rejection kinds** — `malformed_sidecar`, `sidecar_target_missing`, `unresolved_anchor`, `overlapping_anchors`, `uncovered_target_lines` — taking the gate to **17 mechanical kinds**. They enforce per-file `<file>.intent` sidecars and comment-less coverage; they are NOT part of the v1 10-check matrix (so the v1 count above stays 12), and they are gate-only (no new §4.6 *check* in the 10-check sense). The change's specs are the source of truth for their shapes.
>
> **v1.x extension (D.32 — test-pyramid-routing).** Adds **1 gate rejection kind** — `non_test_marker_on_test_intent` — the *reverse* of Check 9: a focal claimant (`intent`/`intent-file`) whose `intent_path` ends in a configured `test_pyramid.suffixes` value is rejected (use `@intent-test`/`@intent-test-file`). Scoped to the focal claim of the test-suffix intent itself (leaves `@intent-support` and non-test-intent claims alone). Takes the gate to **18 mechanical kinds**; again NOT part of the v1 10-check→12-kind matrix. See App. D.32.

```typescript
type Rejection =
  | { kind: "missing_decorator"; declaration: string; file: string; line: number }
  | { kind: "missing_statement_decorator"; statement_excerpt: string; file: string; line: number }                  // v9
  | { kind: "unresolved_intent_path"; reference: string; file: string; line: number }
  | { kind: "unresolved_aspect_id"; intent_path: string; aspect: string; file: string; line: number }
  | { kind: "multiple_intents_on_one_line"; file: string; line: number }
  | { kind: "missing_ignore_because"; intent_path: string; file: string; line: number }
  | { kind: "missing_ignore_reason"; intent_path: string; file: string; line: number }
  | { kind: "invalid_ignore_predicate"; predicate: string; file: string; line: number }
  | { kind: "missing_support_triple"; intent_path: string; aspect: string; file: string; line: number }              // v9
  | { kind: "malformed_support_triple"; triple: string; file: string; line: number }                                 // v9
  // decorate-or-decompose violations are NOT raised by the PreToolUse gate (v1) — see Ch. 4.6 + Ch. 8.9.
  // The mandate is enforced via Engineer proactivity + Verifier surfacing unsatisfied aspects.
  | { kind: "focal_and_support_for_same_intent"; intent_path: string; file: string; line: number }                   // v9
  | { kind: "non_test_path_on_intent_test"; intent_path: string; file: string; line: number };                       // v9
```

### A.9 Role definition frontmatter (updated for v9)

```yaml
---
dusk_role_version: 2                              # bumped to 2 in v9
name: dusk-<role-name>
description: <one-line description>
tools: [Read, ...]                                # advisory tool scope (v1; §9.4)
memory: none | bead | dialog | session            # new in v9
skills: [dusk/<role>/<skill-1>, ...]              # advisory skill list (v1; §9.7)
model: <model-id>                                 # default; overridable per dusk.config.yml
---
```

### A.10 PreToolUse hook wire format (NEW v9)

Dusk installs a hook handler into Claude Code's `.claude/settings.json` `hooks.PreToolUse` array. The handler is invoked on every Write/Edit tool call.

**Settings snippet** (written by `dusk init`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "match": { "tools": ["Write", "Edit"] },
        "type": "command",
        "command": "node node_modules/@dusk/pre-tool-use-hook/cli.js"
      }
    ]
  }
}
```

**Hook input** (stdin, single-line JSON):

```typescript
type HookInput = {
  tool: "Write" | "Edit";
  args: {
    file_path: string;
    content?: string;          // full new content (Write)
    edits?: Array<{            // patch edits (Edit)
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    }>;
  };
  session_id: string;
  transcript_path: string;
};
```

**Hook output** (stdout, single JSON object):

```typescript
type HookOutput =
  | { decision: "approve" }
  | {
      decision: "block";
      reason: string;                       // human-readable for the agent
      structured_rejection: Rejection;      // typed; see App. A.8 for the union
    };
```

Hook exits 0 in both approve and block cases. Process-level failures (parse error, unhandled exception) are treated as "block with kind: hook_internal_error" to fail safe.

### A.11 Error envelope — `DuskError` (NEW v9)

Every MCP tool returns either its success shape OR a `DuskError`:

```typescript
type DuskError = {
  schema_version: 1;
  kind:
    // Pipeline errors
    | "pipeline_iteration_cap_exceeded"
    | "decomposer_intent_unresolved"
    | "decomposer_bead_conflict"               // §6.2 — focal-claim overlap
    | "worktree_creation_failed"
    | "merge_conflict_unresolvable"
    | "test_runner_command_failed"
    // Pause/resume + recovery (NEW v9 — §10.1.1, §6.4.1)
    | "implement_paused_for_authoring"           // recoverable: true; details.resume_token
    | "implement_resume_token_expired"           // recoverable: false; recovery_hint preserves original_request
    | "bead_intent_revision_needed"              // recoverable: true; Level 2 recovery — see intent-proposal.yaml
    | "bead_frozen"                              // recoverable: false; Level 3 freeze; manual inspection
    | "bead_aborted"                             // recoverable: false; Level 4 — could not serialize freeze
    // Cancel (NEW v9 — §10.1.2)
    | "cancellation_already_committed"           // informational; bead_id was already merged before cancel observed
    // Author errors
    | "author_dialog_id_unknown"
    | "author_stage_invalid_response"
    | "author_intent_schema_invalid"
    // Verifier errors
    | "verifier_evidence_too_large"
    | "verifier_model_call_failed"
    // Index / decoration errors
    | "intent_path_unresolved"
    | "decoration_parse_error"                   // also fires on matrix-predicate negation per §3.1.1
                                                 // and antecedent-grammar violations per §3.2.1
    // Harness errors
    | "task_tool_call_failed"
    | "pretooluse_hook_not_installed"
    | "config_invalid"
    // Catch-all
    | "internal_error";
  step?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;     // pipeline step where error occurred (if applicable)
  bead_id?: string;
  trace_id?: string;
  message: string;                                // human-readable
  details?: Record<string, unknown>;              // structured per-kind context
  recoverable: boolean;                           // true → retry possible; false → manual intervention
  recovery_hint?: string;                         // e.g. "Run `dusk doctor --check-hook --repair` to fix"
};
```

**Recovery semantics:**

- `recoverable: true` → harness can retry the same MCP call after acting on `recovery_hint`. Examples:
  - `pretooluse_hook_not_installed` → run `dusk doctor --check-hook --repair`.
  - `implement_paused_for_authoring` → drive `dusk_author_*` dialog, then re-call `dusk_implement({resume_token})`.
  - `bead_intent_revision_needed` → review `intent-proposal.yaml`, invoke `dusk_author_continue` to refine intents.
  - `author_dialog_id_unknown` → start a fresh `dusk_author_start`.
- `recoverable: false` → user / developer intervention required. Examples:
  - `merge_conflict_unresolvable` → human pass on the conflict.
  - `decomposer_bead_conflict` → authoring changes (intent disambiguation).
  - `bead_frozen` → manual inspection of `freeze-state.md`, then `dusk implement --resume <bead-id>`.

**`CancelResult` schema (success shape returned by `dusk_cancel`):**

```typescript
type CancelResult = {
  schema_version: 1;
  cancelled: {
    beads_short_circuited: string[];
    cancelled_worktrees: string[];                 // branches removed (no commits)
    partial_commits: Array<{                       // branches kept with bead commits
      bead_id: string;
      branch: string;
      commit_sha: string;
      merge_decision: "user_choose";               // hint for the harness
    }>;
    cancelled_dialogs: string[];
    cancelled_checkpoints: string[];
    bead_memories_deleted: string[];
  };
  preserved: {
    already_committed: Array<{                     // beads merged to main before cancel observed
      bead_id: string;
      commit_sha: string;
    }>;
    in_flight_tasks_drained: number;
  };
  trace_id: string;                                // trace event for the cancellation itself
  drain_duration_ms: number;                       // how long step 2 (drain) took
};
```

---

## Appendix B: Worked Example — `sendNotification` Under v9 Decoration

This appendix shows a full clean-decoration rewrite of `packages/api/src/services/notifications/index.ts` under the v9 decoration model. Every statement is decorated. Every nested user-defined function call is extracted. Every `@intent-support` carries an inline NL triple. Cross-cutting intents are declared at the function level and supported at the touching lines.

### B.1 Intents in scope

For this example, the relevant intents are:

- `notifications/send` (primary intent for this function) with aspects: `normalize-target`, `persist-first`, `publish-sync-per-insert`, `respect-opt-out`, `cleanup-device-not-registered`, `persistence-not-blocked-by-push`
- `db/use-drizzle-orm` with aspect: `typed-queries-only`
- `sync/pubsub-on-create` with aspect: `event-per-insert`
- `observability/structured-logging` with aspect: `structured-payloads`
- `error-handling/observable-failures` with aspect: `catch-log-continue`

Test-pyramid children of `notifications/send`:
- `notifications/send/unit-tests`
- `notifications/send/integration-tests`

### B.2 The rewritten `sendNotification`

```typescript
import { eq, inArray } from "drizzle-orm";
import { syncChannel, type SyncEvent, type Notification } from "@dusk/shared";
import { notifications, pushTokens, users } from "../../db/schema.js";
import { getPushAdapter } from "../push/index.js";
import { getLogger } from "../../lib/logger.js";
import type { Context } from "../../context.js";
import type { PgPubSub } from "../../pubsub.js";

type Db = Context["db"];

type NotificationTarget = { userId: string } | { userIds: string[] };

type NotificationPayload = {
  title: string;
  body: string;
  actionUrl?: string | null;
};

type SendNotificationResult = {
  notificationIds: string[];
  pushResults: { sent: number; skipped: number; failed: number };
};

// @intent notifications/send [normalize-target]
function normalizeUserIds(target: NotificationTarget): string[] {
  // @intent notifications/send [normalize-target]
  if ("userId" in target) return [target.userId];

  // @intent notifications/send [normalize-target]
  return target.userIds;
}

// @intent notifications/send [normalize-target, persist-first, publish-sync-per-insert, respect-opt-out, cleanup-device-not-registered, persistence-not-blocked-by-push]
// @intent db/use-drizzle-orm [typed-queries-only]
// @intent sync/pubsub-on-create [event-per-insert]
// @intent observability/structured-logging [structured-payloads]
// @intent error-handling/observable-failures [catch-log-continue]
export async function sendNotification(
  db: Db,
  pubsub: PgPubSub,
  target: NotificationTarget,
  payload: NotificationPayload,
): Promise<SendNotificationResult> {
  // @intent-support notifications/send [normalize-target] ["the target normalization call", "invokes", "the normalizeUserIds helper to flatten the target into a uniform user ID array"]
  const userIds = normalizeUserIds(target);

  // @intent-support notifications/send [persist-first] ["the row builder", "constructs", "a notification row per target user from the payload fields"]
  const rows = userIds.map((userId) => ({
    userId,
    title: payload.title,
    body: payload.body,
    actionUrl: payload.actionUrl ?? null,
  }));

  // @intent notifications/send [persist-first]
  // @intent-support db/use-drizzle-orm [typed-queries-only] ["the insert chain", "uses", "Drizzle's typed insert with values and returning to write notifications atomically"]
  const inserted = await db.insert(notifications).values(rows).returning();

  // @intent-support sync/pubsub-on-create [event-per-insert] ["the channel resolution", "computes", "the sync channel name for the notification entity via the syncChannel helper"]
  const notificationChannel = syncChannel("notification");

  // @intent-support notifications/send [publish-sync-per-insert] ["the publish loop", "iterates", "over each inserted notification to emit a sync event"]
  for (const notification of inserted) {
    // @intent-support notifications/send [publish-sync-per-insert] ["the timestamp capture", "captures", "the current epoch milliseconds for the event emission timestamp"]
    const timestamp = Date.now();

    // @intent-support notifications/send [publish-sync-per-insert] ["the event payload", "constructs", "a SyncEvent carrying the created action, the inserted notification data, and the captured timestamp"]
    const event: SyncEvent<typeof notification> = {
      action: "created",
      data: notification,
      timestamp,
    };

    // @intent notifications/send [publish-sync-per-insert]
    // @intent-support sync/pubsub-on-create [event-per-insert] ["the channel publish call", "delivers", "the prepared sync event onto the resolved notification channel via pubsub"]
    await pubsub.publish(notificationChannel, event);
  }

  // @intent-support notifications/send [respect-opt-out, cleanup-device-not-registered] ["the push delivery counters", "initialize", "sent skipped and failed counts to zero for tracking push outcomes"]
  const counts = { sent: 0, skipped: 0, failed: 0 };

  // @intent notifications/send [persistence-not-blocked-by-push]
  // @intent-support error-handling/observable-failures [catch-log-continue] ["the push isolation try block", "isolates", "all push delivery side effects so failures cannot prevent persistence success"]
  try {
    // @intent-support notifications/send [respect-opt-out] ["the opt-out predicate", "expresses", "the inArray match restricting opt-out lookup to target users"]
    const optOutTargetPredicate = inArray(users.id, userIds);

    // @intent-support notifications/send [respect-opt-out] ["the opt-out query", "fetches", "pushOptOut preference for each target user via the opt-out predicate"]
    // @intent-support db/use-drizzle-orm [typed-queries-only] ["the select chain", "uses", "Drizzle's typed select with from and where to fetch user opt-out preferences"]
    const optOutRows = await db
      .select({ id: users.id, pushOptOut: users.pushOptOut })
      .from(users)
      .where(optOutTargetPredicate);

    // @intent-support notifications/send [respect-opt-out] ["the opted-out filter", "filters", "the opt-out rows to those with pushOptOut true"]
    const optedOutRows = optOutRows.filter((u) => u.pushOptOut);

    // @intent-support notifications/send [respect-opt-out] ["the opted-out id projection", "projects", "the opted-out rows to a list of user ids"]
    const optedOutIdList = optedOutRows.map((u) => u.id);

    // @intent notifications/send [respect-opt-out]
    const optedOutIds = new Set(optedOutIdList);

    // @intent-support notifications/send [respect-opt-out] ["the eligible filter", "removes", "opted-out users from the push delivery candidate list"]
    const eligibleUserIds = userIds.filter((id) => !optedOutIds.has(id));

    // @intent-support notifications/send [respect-opt-out] ["the skipped counter update", "records", "the count of users skipped due to opt-out"]
    counts.skipped = userIds.length - eligibleUserIds.length;

    // @intent-support notifications/send [respect-opt-out, cleanup-device-not-registered] ["the eligibility gate", "guards", "all subsequent push work behind the eligible-user condition"]
    if (eligibleUserIds.length > 0) {
      // @intent-support notifications/send [respect-opt-out] ["the token predicate", "expresses", "the inArray match restricting token lookup to eligible users"]
      const tokenTargetPredicate = inArray(pushTokens.userId, eligibleUserIds);

      // @intent-support notifications/send [respect-opt-out] ["the token query", "fetches", "push tokens for eligible users via the token predicate"]
      // @intent-support db/use-drizzle-orm [typed-queries-only] ["the select chain", "uses", "Drizzle's typed select with from and where to fetch push tokens"]
      const tokens = await db.select().from(pushTokens).where(tokenTargetPredicate);

      // @intent-support notifications/send [respect-opt-out] ["the token presence gate", "guards", "push dispatch behind having at least one token"]
      if (tokens.length > 0) {
        // @intent-support notifications/send [respect-opt-out] ["the push params builder", "constructs", "push parameters from tokens and payload including optional actionUrl data"]
        const pushParams = tokens.map((t) => ({
          token: t.token,
          title: payload.title,
          body: payload.body,
          ...(payload.actionUrl && { data: { actionUrl: payload.actionUrl } }),
        }));

        // @intent-support notifications/send [respect-opt-out] ["the push adapter resolution", "obtains", "the configured push adapter instance"]
        const pushAdapter = getPushAdapter();

        // @intent-support notifications/send [respect-opt-out] ["the push dispatch", "sends", "the batched push request via the resolved push adapter"]
        const results = await pushAdapter.sendBatch(pushParams);

        // @intent-support notifications/send [cleanup-device-not-registered] ["the stale token accumulator", "initializes", "an empty array for collecting stale device tokens"]
        const staleTokenIds: string[] = [];

        // @intent-support notifications/send [cleanup-device-not-registered] ["the result categorizer loop", "walks", "each push result to update counters and accumulate stale token ids"]
        for (let i = 0; i < results.length; i++) {
          // @intent-support notifications/send [respect-opt-out] ["the success branch", "increments", "the sent counter for delivered notifications"]
          if (results[i].success) {
            counts.sent++;
            continue;
          }

          // @intent-support notifications/send [cleanup-device-not-registered] ["the stale token branch", "records", "a failed delivery and captures the token id for cleanup"]
          if (results[i].deviceNotRegistered) {
            counts.failed++;
            staleTokenIds.push(tokens[i].id);
            continue;
          }

          // @intent-support notifications/send [respect-opt-out] ["the other failure branch", "increments", "the failed counter for non-recoverable push errors"]
          counts.failed++;
        }

        // @intent-support notifications/send [cleanup-device-not-registered] ["the stale presence gate", "guards", "cleanup work behind having at least one stale token id"]
        if (staleTokenIds.length > 0) {
          // @intent-support notifications/send [cleanup-device-not-registered] ["the stale token predicate", "expresses", "the inArray match restricting deletion to accumulated stale ids"]
          const stalePredicate = inArray(pushTokens.id, staleTokenIds);

          // @intent notifications/send [cleanup-device-not-registered]
          // @intent-support db/use-drizzle-orm [typed-queries-only] ["the delete chain", "uses", "Drizzle's typed delete with where to remove stale push tokens"]
          await db.delete(pushTokens).where(stalePredicate);

          // @intent-support observability/structured-logging [structured-payloads] ["the logger resolution", "obtains", "the application logger instance"]
          const logger = getLogger();

          // @intent-support notifications/send [cleanup-device-not-registered] ["the cleanup count payload", "constructs", "the structured log payload reporting the deleted token count"]
          const cleanupPayload = { count: staleTokenIds.length };

          // @intent notifications/send [cleanup-device-not-registered]
          // @intent-support observability/structured-logging [structured-payloads] ["the cleanup log call", "records", "the deleted stale token count with structured object payload"]
          logger.info(cleanupPayload, "Deleted stale push tokens (DeviceNotRegistered)");
        }
      }
    }
  } catch (err) {
    // @intent-support observability/structured-logging [structured-payloads] ["the logger resolution", "obtains", "the application logger instance for error reporting"]
    const logger = getLogger();

    // @intent-support error-handling/observable-failures [catch-log-continue] ["the error payload", "constructs", "the structured log payload wrapping the captured error"]
    const errorPayload = { err };

    // @intent observability/structured-logging [structured-payloads]
    // @intent-support error-handling/observable-failures [catch-log-continue] ["the error log call", "records", "the push failure with err object so persistence success is preserved and the failure is observable"]
    logger.error(errorPayload, "Push delivery failed (notifications still persisted)");
  }

  // @intent-support notifications/send [persist-first] ["the notification id projection", "projects", "the inserted rows to their id list for the response"]
  const notificationIds = inserted.map((n) => n.id);

  // @intent-support notifications/send [persist-first, respect-opt-out, cleanup-device-not-registered] ["the result builder", "constructs", "the SendNotificationResult with notification ids and push delivery counts"]
  const result: SendNotificationResult = {
    notificationIds,
    pushResults: counts,
  };

  // @intent-support notifications/send [persist-first] ["the return statement", "returns", "the constructed result to the caller"]
  return result;
}

// @intent notifications/broadcast [target-all-users]
// @intent db/use-drizzle-orm [typed-queries-only]
export async function broadcastNotification(
  db: Db,
  pubsub: PgPubSub,
  payload: NotificationPayload,
): Promise<SendNotificationResult> {
  // @intent-support notifications/broadcast [target-all-users] ["the all-users query", "fetches", "every user id from the users table"]
  // @intent-support db/use-drizzle-orm [typed-queries-only] ["the select chain", "uses", "Drizzle's typed select with id projection from users"]
  const allUsers = await db.select({ id: users.id }).from(users);

  // @intent-support notifications/broadcast [target-all-users] ["the user id projection", "projects", "the all-users rows to a flat user id list"]
  const userIds = allUsers.map((u) => u.id);

  // @intent-support notifications/broadcast [target-all-users] ["the target construction", "builds", "the multi-user target object for sendNotification"]
  const target = { userIds };

  // @intent notifications/broadcast [target-all-users]
  return sendNotification(db, pubsub, target, payload);
}
```

### B.3 What changed structurally from the original

| Original pattern | v9 rewrite |
|---|---|
| `let sent = 0; let skipped = 0; let failed = 0;` | Single `const counts = { sent: 0, skipped: 0, failed: 0 };` with object-property mutation downstream |
| `pubsub.publish(syncChannel("notification"), {...} satisfies SyncEvent<...>)` | `syncChannel("notification")` extracted to `notificationChannel` const above the loop (loop-invariant hoist); event object extracted to its own `const event`; publish is the third statement |
| `await db.select(...).from(users).where(inArray(users.id, userIds))` | `inArray(users.id, userIds)` extracted to `optOutTargetPredicate` const (predicate construction has separable intent participation); the Drizzle chain stays as one statement because its steps share the same intent footprint |
| `optOutRows.filter(...).map(...)` chain | Split: `.filter` to `optedOutRows`, `.map` to `optedOutIdList`, `new Set(...)` to `optedOutIds` |
| `await getPushAdapter().sendBatch(pushParams)` | `getPushAdapter()` extracted to `pushAdapter` const |
| `getLogger().info({...}, "...")` | `getLogger()` extracted to `logger` const; payload object extracted to its own const; `logger.info(payload, "...")` is the call |
| `getLogger().error({err}, "...")` (in catch) | Same treatment |
| `else if` chain in the result loop | Flattened with `continue` after each branch |
| `return { notificationIds: inserted.map(...), pushResults: {...} }` | Projection extracted to `notificationIds` const; result object extracted to `result` const; return is the final statement |

### B.4 What the Verifier sees for one aspect

When the Verifier evaluates `notifications/send [publish-sync-per-insert]`:

**Focal claimants:**
- Line decorated `@intent notifications/send [publish-sync-per-insert]` — the `await pubsub.publish(notificationChannel, event)` call inside the loop

**Support claimants:**
- The publish loop itself — iterates over each inserted notification
- The timestamp capture inside the loop
- The event payload construction inside the loop

The Verifier reads these four statements (plus their surrounding context as needed) and evaluates the triple: *the publish loop emits one sync event per inserted notification on the notification channel*. It does NOT read the opt-out logic, the push dispatch, the error handling, or the result construction — those participate in different aspects.

This is the scoping payoff. Per-aspect verification reads ~4 lines instead of ~90.

### B.5 What the test intents look like

```yaml
# .ia/intents/notifications/send/unit-tests/intent.yaml
schema_version: 1
id: notifications/send/unit-tests
description: |
  Unit tests for sendNotification cover the persistence, publish-per-insert,
  opt-out, stale-token cleanup, and persistence-not-blocked-by-push behaviors
  with mocked db, pubsub, and push adapter.

obligation: must
compose: all

triples:
  - id: covers-persist-first
    subject: "the sendNotification unit-test suite"
    predicate: "include"
    object: "a passing case verifying that db.insert is called before any pubsub.publish call"
  - id: covers-publish-per-insert
    subject: "the sendNotification unit-test suite"
    predicate: "include"
    object: "a case verifying that one pubsub.publish call is made per inserted notification"
  - id: covers-opt-out
    subject: "the sendNotification unit-test suite"
    predicate: "include"
    object: "a case verifying that users with pushOptOut true are excluded from push delivery and counted as skipped"
  - id: covers-stale-cleanup
    subject: "the sendNotification unit-test suite"
    predicate: "include"
    object: "a case verifying that tokens with deviceNotRegistered results are deleted from the database"
  - id: covers-push-failure-isolation
    subject: "the sendNotification unit-test suite"
    predicate: "include"
    object: "a case verifying that a thrown error from the push adapter does not prevent persistence and does not propagate to the caller"
  - id: isolated-from-infrastructure
    subject: "the sendNotification unit-test suite"
    predicate: "runs against"
    object: "mocked db, pubsub, and push adapter instances with no real database, broker, or push gateway connections"
    # NOTE: the phrase "with no real ..." in the OBJECT slot is constituent
    # negation inside a noun phrase — legal per §3.1.1's matrix/constituent
    # rule. The matrix predicate ("runs against") is affirmative. The parser
    # rejects matrix-predicate negation in PREDICATE slots only.

relates_to:
  - kind: parent
    target: notifications/send
```

```typescript
// packages/api/src/services/notifications/index.test.ts
// @intent-test-file notifications/send/unit-tests

import { describe, test, expect, vi, beforeEach } from "vitest";
import { sendNotification } from "./index.js";

describe("sendNotification", () => {
  // ... fixtures and mocks ...

  // @intent-test notifications/send/unit-tests [covers-persist-first]
  test("persists notifications before publishing sync events", async () => { /* ... */ });

  // @intent-test notifications/send/unit-tests [covers-publish-per-insert]
  test("publishes one sync event per inserted notification", async () => { /* ... */ });

  // @intent-test notifications/send/unit-tests [covers-opt-out]
  test("excludes opted-out users from push and counts them as skipped", async () => { /* ... */ });

  // @intent-test notifications/send/unit-tests [covers-stale-cleanup]
  test("deletes push tokens for deviceNotRegistered results", async () => { /* ... */ });

  // @intent-test notifications/send/unit-tests [covers-push-failure-isolation]
  test("persists notifications even when push adapter throws", async () => { /* ... */ });
});
```

The Test Runner discovers this file via `@intent-test-file`, runs Vitest scoped to it, and evaluates each test-intent triple against the test results.

---

## Appendix C: v8 → v9 Migration Map

| v8 | v9 disposition |
|---|---|
| Decoration on declarations only (statements implicitly covered) | **Decoration extended to every statement.** New markers `@intent-support`, `@intent-test`, `@intent-test-file`. New PreToolUse checks 6-10. |
| Cross-cutting intents at directory scope via `.intent` files | **Cross-cutting intents decorated on touching functions.** Directory `.intent` reserved for structural directory invariants. |
| 8-step pipeline | **9 steps.** Step 6 (Test Execution) inserted after long-cycle pass; subsequent steps renumbered. |
| 8 sub-agent roles | **9 roles.** Test Runner added; persistence semantics formalized via `memory:` frontmatter. |
| Sub-agent persistence implicit in role descriptions | **Explicit `memory:` frontmatter** with four scopes: `none`, `bead`, `dialog`, `session`. Verifier explicitly `memory: none`. |
| No sub-agent skill system | **Role-bound skills under `.claude/skills/dusk/<role>/<skill>.md`.** Shipped baseline + project-specific extension. |
| PreToolUse: 5 mechanical checks | **10 checks** (12 typed rejection kinds). Decoration completeness, support-triple validity, focal/support contradiction, test-pyramid path validation, matrix-predicate negation in support triples (check 10). The agentic `S ⊆ D` decorate-or-decompose check is intentionally NOT in the gate — the mandate stays in §4.5 but enforcement is via Engineer proactivity + Verifier unsatisfied-aspect surfacing. |
| Atomic commit trailers (Intent, Bead-id, Verdict-id, Trace-id, Verifier-model, Long-cycle-samples) | **Extended with Test-Intent, Test-Runner-model, Test-Suites-passed.** |
| `/dusk-doctor` slash command | **Extended to validate decoration completeness across project.** |
| Test handling | **Test pyramid encoded via reserved child-intent suffixes (`/unit-tests`, `/integration-tests`, `/e2e-tests`); Test Runner role executes; verdicts roll up to parent intent satisfaction.** |
| `dusk_status`, `dusk_inspect` outputs | **Extended with `support_claims`, `test_intents`, `recent_test_runs` fields.** |
| Master flow diagram v1 | **Master flow diagram v2** (already updated with proper multi-node sub-flows for loop-back paths); needs further update to depict Step 6 Test Execution. |
| Single existing notifications/send example | **Appendix B added** — full clean-decoration rewrite under v9 model with side-by-side commentary on structural changes. |
| Triples carried a `negated: bool` flag (v8 + early v9 drafts) | **Affirmative-only triples (§3.1).** Negated flag dropped. Author rephrases negative assertions affirmatively; parser rejects negation markers in triple slots. Closes a known LLM weak spot. |
| Triples had no quantifier vocabulary | **`quantifier` field added** (`at-least-one` default, `each`, `exactly-one`, `at-most-one`, `none`, `at-least-N`, `at-most-N`) + optional `scope`. Verifier checks cardinality explicitly instead of parsing English. |
| `compose: all | any | none` only | **`compose: implies` added** for conditional rules ("if X then Y must hold") using `antecedent` + `consequent` triple groups. |
| `relates_to: [string, ...]` flat list | **Typed `relates_to`** with five kinds: `{kind: parent | implies | conflicts | supersedes | sibling, target: <path>}`. Decomposer + Verifier act on the typed edges. v8 flat-list loaded as `kind: sibling` with deprecation warning. |
| Schema version 1 | **`schema_version: 2`** for v9 intents. |
| Engineer ⊥ Verifier asymmetry asserted | **Fresh-Verifier audit benchmark** (§7.5) added to Sprint 9 — makes the asymmetry falsifiable, not just asserted. |
| Engineer bead memory format unspecified | **Structured bead-memory format** (§9.6.1) — `Current diagnosis` / `Approaches tried` / `Verifier signals` / `Intent set in scope` / `Files being modified`, with compaction at >3 verdict entries. |
| Short-cycle: 20-iter cap with no learning signal | **Iter-5 forced convergence diagnosis + iter-15 early escalation** added (§6.4). The diagnosis is consumed by the **Bead Orchestrator only** — it NEVER enters the Verifier's spawn payload (see the round-3 row below and §6.4 / §9.6.1). Earlier drafts leaked it into the Verifier on iter ≥ 6; that was corrected — the Verifier stays genuinely fresh per call, and a test-mode `raw_prompt` capture (App. A.6) makes the no-leak property falsifiable. |
| Long-cycle: N=3 samples | **N=10 with sequential early-stop** (§6.5). Higher confidence; stops on first reject. |
| Cross-cutting intent claim overlap (no pre-emptive check) | **Decomposer-time check moved into Sprint 5** (§8.9). Prevents two parallel beads from issuing conflicting focal claims at DAG construction. |
| Bead DAG dependencies from `relates_to` only | **File-overlap edges added** (§6.2). Decomposer serializes any two beads whose predicted file impact overlaps. |
| Test-pyramid satisfaction = annotation match + runtime pass | **Two-stage satisfaction** (§3.4). Verifier evaluates whether the test body verifies what the test-intent triple claims; only verified tests feed Test Runner execution. |
| Tool scoping: "strictly enforced at spawn time" | **Advisory in v1** (§9.4). The `tools:` frontmatter is honored as configuration, not as a hard sandbox. PreToolUse gate provides the actual safety boundary. |
| Skills role-bound: "runtime enforces scope by discovery path" | **Skills organized by role; advisory in v1** (§9.7). Role prompt instructs which skills to load; no harness-level scoping. |
| Harness contract: 5 capabilities (incl. scoped skill discovery) | **4 capabilities** (§10.3). Scoped skill discovery moved to Dusk-owned responsibility. |
| `dusk_author` as single MCP call | **Continuation pattern** (§10.1): `dusk_author_start` → `dusk_author_continue × N` → `dusk_author_finalize`. Maps cleanly onto MCP's call/response shape. |
| Sub-agent spawn mechanism: implicit | **Explicit (§9.9).** Claude Code's Task tool with `subagent_type: dusk-<role>`. Memory + skills materialized by Dusk before the spawn call. |
| No `dusk_cancel` tool | **Added** (§10.1). Long-running pipelines have a graceful abort path. |
| No MCP resources | **Added** (§10.1): `dusk://intents`, `dusk://intents/<path>`, `dusk://traces/recent`, `dusk://beads/active`, `dusk://beads/<id>`. Cheap host-side discovery. |
| No PreToolUse hook wire format | **Specified** (§4.6.1, App. A.10). stdin/stdout JSON contract; settings.json snippet written by `dusk init`. |
| No error envelope | **`DuskError` union added** (App. A.11). Every MCP tool returns success-or-error. |
| Test-pyramid suffixes hardcoded `[unit-tests, integration-tests, e2e-tests]` | **Configurable** in `dusk.config.yml` (§3.4) — supports `contract-tests`, `property-tests`, etc. |
| `S ⊆ D` static analysis deferred to v1.x | **REPROMOTED to v1, Sprint 9** (§4.6, §8.9) — framed as **drift detection** for decoration erosion, not real-time enforcement. |
| Affirmative-only triples (early v9 draft policy) | **Replaced by `polarity: positive \| negative` field** (§3.1). Slots remain affirmative English; structural negation handled by runtime inversion outside the LLM call. Cleaner author UX + simpler parser + simpler Verifier prompt. |
| Lexical-strict negation parser (early v9 draft) | **AST-aware matrix/constituent rule** (§3.1.1). Matrix-predicate negation rejected in predicate slot; constituent negation inside NPs (subject/object slots) is legal. Eliminates false positives like rejecting "a function with no required arguments." |
| `compose: implies` antecedent semantics undefined | **Decorator-index facts ONLY, evaluated deterministically** (§3.2.1). Closed antecedent predicate vocabulary; antecedent group evaluated by index lookup, never by LLM. Vacuous satisfaction on antecedent-false. Prevents the silent-under-firing failure mode where LLM-judged antecedents could suppress real consequent failures. |
| Six typed `relates_to` kinds | **Five kinds** (§2.1). `refines` collapsed into `parent` — the "narrowing" semantic is implicit in path hierarchy, and authors will conflate the two if both exist. Early-v9 `kind: refines` migrates to `kind: parent` (strictly stronger behavior). |
| Derived index unspecified under parallel worktrees | **Session-snapshot + bead-delta model** (§2.10). Snapshot built once at pipeline entry, immutable for the run, identified by `index_snapshot_id`. Per-bead deltas visible only to that bead. Cross-bead reads see snapshot only. |
| Engineer's iter-5 diagnosis flowed into Verifier spawn payload | **Diagnosis is Bead Orchestrator-only** (§6.4, §9.6.1). The Verifier's spawn payload is unchanged across iterations — preserves the asymmetry the §7.5 audit validates. Diagnosis drives orchestrator-side routing (recovery ladder, livelock detection, escalation). |
| Stuckness detection only via hard iter-5 ceiling | **Stuckness detector** (§6.4.2). Deterministic predicate over `verdict_delta_from_prior` + stable failing-triple set across a 3-iter window. Fires diagnosis as early as iter 3; iter-5 ceiling preserved as fallback. |
| Per-bead iteration cap = 20 (per Step-4 entry only) | **40-iter lifetime budget across re-entries + 4-level recovery ladder** (§6.4.1). Level 1 partial commit → Level 2 intent-modification proposal → Level 3 freeze → Level 4 hard abort. Bounds the cross-step retry graph (Steps 4↔5↔6 loops). |
| Long-cycle sequential early-stop = first reject | **N=2 confirmation pass on first reject** (§6.5). Spawn 2 additional fresh Verifiers; ≥1/2 confirm → regression; both override → flaky verdict dismissed. Confirmation calls feed the fresh-Verifier audit via `confirmation_of_trace_id`. |
| Verifier per-triple verdict = flat `pass \| fail` | **Split verdict** (§3.3, App. A.4): `focal_verdict` (drives Engineer re-draft) + `support_quality` (advisory only). Support claims also gain per-claim `triple_verdict: matches \| mismatch \| vague`. |
| Test-Verifier livelock: opaque "tests failed convergence" | **`TestVerifierLivelockReport` + `dusk_resolve_livelock`** (§3.4.1). 3-condition detector (same triple + slot-focus concentration + structural-approach diversity); user resolves via `accept_test_as_is` / `modify_triple` / `escalate`. |
| Bead memory as single "Approaches tried" log | **Dual-channel format** (§9.6.1): `Approaches tried (impl)` + `Approaches tried (test-authoring)`. Triple-slot focus field per approach. Mechanical compaction only — never LLM-summarized. |
| Fresh-Verifier audit = 2 axes (variance + similarity) | **3 axes — citation precision added** (§7.5.1). Structural parse of `file:line` references vs `ground_truth_defect_loc`. No LLM-judge (would re-introduce correlation). High-similarity × Low-precision quadrant is the rubber-stamp signature. |
| `dusk_implement` ↔ `dusk_author` interleaving hand-waved | **Disk-checkpoint resume contract** (§10.1.1). Decomposer-pause returns `DuskError{kind: "implement_paused_for_authoring", details.resume_token}`; harness drives dialog; resumes via `dusk_implement({resume_token})`. 24h TTL; survives crashes. |
| `dusk_cancel` sketched as "graceful shutdown" | **Cooperative cancellation contract** (§10.1.2). Set flag + drain in-flight Task calls + ordered cleanup. `CancelResult` distinguishes `cancelled[]` from `preserved[]` (already committed). Honest about Claude Code's actual abort surface. |
| `dusk init` settings.json merge unspecified | **`_dusk_marker` idempotency anchor + conflict-prompt three options** (§4.6.1). Never silent clobber. `dusk doctor --check-hook --repair` for drift. |
| MCP resources as the only discovery surface | **Resources + paired read-only tools** (§10.1). `dusk_list_intents`, `dusk_get_intent`, `dusk_list_traces`, `dusk_list_beads`, `dusk_get_bead`, `dusk_list_implement_checkpoints`. Works on hosts without resource browsing. |
| PreToolUse gate = 9 checks | **10 checks** (§4.6). Check 10: matrix-predicate negation in `@intent-support` predicate slot — enforces the §3.1.1 rule at write time. |

---

## Appendix D: Open Decisions

**D.1 (resolved).** Aspect-list delimiter: square brackets.

**D.2 (resolved).** Predicates are free natural language. No bounded set.

**D.3 (resolved — updated v9).** Long-cycle round count defaults to **10** with sequential early-stop on first reject (reviewer feedback: N=3 is statistically too small for the regression-detection claim). Tunable per project via `dusk.config.yml`.

**D.4 (deferred to v1.x).** Engineer model = Verifier model = Test Runner model in v1. Heterogeneous models deferred (Ch. 8.4).

**D.5 (resolved).** No recognizers, no vocabulary file.

**D.6 (resolved).** Glossary removed; no per-language considerations.

**D.7 (locked).** Engineer's access to Verifier rationale: full per-triple rejection rationale (file, lines, quote, why, **focal+support claimant set**). Necessary for effective iteration.

**D.8 (locked).** Bead-id, verdict-id, trace-id, test-verdict-id format: `<prefix>_<14-digit-yyyymmddhhmmss><3-digit-seq>` — e.g., `bd_2026052600001`, `vd_2026052600001`, `tr_2026052600001`, `tv_2026052600001`. Sortable, prefix-namespaced.

**D.9 (locked).** Worktree branch naming: `dusk/<bead-id>`. One branch per bead; cleaned up after merge.

**D.10 (locked).** Bead's intent doesn't exist yet: Decomposer signals Root, Root invokes Author with the user, Author commits new intents (including any test-pyramid children proposed during Stage 4), Decomposer resumes.

**D.11 (resolved in v9).** `@intent-support` triple inline (Option A), not sidecar referenced (Option B). Reason: humans don't read this code; AI consumers benefit from atomic colocation; refactoring stays atomic; no drift between code and triple. **Scope:** this verdict governs **comment-bearing** code, where inline is possible and therefore mandatory; it does NOT extend to comment-less formats, which have no inline option — those are covered by a per-file sidecar with structural (not line) anchors per **D.28**. D.11 and D.28 are consistent: inline wherever the format permits a comment; sidecar only where it cannot.

**D.12 (resolved in v9).** Cross-cutting intents decorated on touching functions, not only at directory scope. Reason: visibility (function declares what it touches), scoping for verification (Verifier reads function-local claims, not directory-wide), refactor safety (decorator removal tied to behavior removal).

**D.13 (resolved in v9).** Code-style extraction rule applies to user-defined function calls only, not built-in primitives (`Math.max`, `Object.keys`) or property access. The PreToolUse check 8 (Ch. 4.6) implements this distinction.

**D.14 (locked).** Method chains on a single builder/query value (Drizzle, RxJS, fluent APIs) are exempted from the extraction rule. Documented in Ch. 4.5 with explicit example.

**D.15 (open).** Test-pyramid intent triples — recommended canonical triple set per pyramid layer (e.g., "no DB" for unit tests). Authoring guidance for Stage 4 of the authoring flow. Not blocking v1, but documentation deliverable for first adoption.

**D.16 (open).** Test runner per-language strategy for polyglot monorepos. Currently single-runner. Deferred to v1.x (Ch. 8.8).

**D.17 (resolved in v9).** Negation model: `polarity: positive | negative` field on triples, with subject/predicate/object always affirmative English. Runtime inverts the LLM's affirmative verdict post-call. The LLM never sees negated framing. Earlier v9 drafts attempted lexical-affirmative-only enforcement; that compounded into parser lexicon games and a canonical worked example that violated its own parser. The polarity model separates structural negation (runtime concern) from predicate content (NL / LLM concern), mirroring Rego and Alloy.

**D.18 (resolved in v9).** `compose: implies` antecedent semantics: decorator-index facts only, evaluated deterministically. Closed antecedent predicate vocabulary (`is decorated with`, `claims any aspect of`, `is enclosed by a decoration of`). Antecedent group result is index-derived; consequents are LLM-evaluated only when the antecedent holds. Prevents the silent-under-firing failure mode where probabilistic antecedent judgment could suppress consequent failures on `must` rules.

**D.19 (resolved in v9).** `parent` vs `refines` typed-`relates_to` kinds: collapsed to single `parent` kind. The "narrowing" semantic is implicit in path hierarchy (`api/pagination/cursor-only` IS the narrowing of `api/pagination`). Authors would conflate the two; keeping both produces non-determinism. Early-v9 `kind: refines` migrates to `kind: parent` (strictly stronger behavior).

**D.20 (resolved in v9).** Negation detection rule: AST-aware matrix-vs-constituent distinction. Predicate slot uses the full lexicon (matrix-predicate negation rejected); subject and object slots reject only sentence-level negation auxiliaries attached to a matrix verb. Constituent negation inside noun phrases (`"a function with no required arguments"`, `"a sandboxed environment free of network access"`) is legal. POS-aware lightweight tagger (~200 LOC, no ML dependency).

**D.21 (resolved — implementation board round 4).** v1 model posture is **frontier-tier, determinism-first**, not mid-tier (§7.1). All roles default to a single frontier model; Verifier/Test-Runner verdict calls run at `temperature: 0`. v1 is not built to scale; tier-down/cost optimization is deferred to the Sprint-9 efficacy benchmark. Rationale: a frontier model + the polarity/quantifier/deterministic-antecedent machinery that moves hard logic outside the LLM call makes single-shot structural verdicts stable enough to test without scale-grade retry infrastructure.

**D.22 (resolved — implementation board round 4).** Engineer ⊥ Verifier freshness is asserted as a **structural no-leak property over a test-mode `raw_prompt` capture** (App. A.6) plus the empirical §7.5 audit — NOT as "byte-identical spawn payload across iterations." Byte-identity is both too strong (breaks on benign field reordering) and too weak (identical payloads can still produce correlated verdicts). Control-flow behavior that reacts to verdicts (budgets, stuckness, confirmation pass, livelock, recovery ladder) is tested with a **scripted-verdict Verifier double** (zero model calls); verdict-correctness is tested against the real frontier model. The features that need sampling variance (the §7.5 audit, the §6.5 confirmation pass) use explicit-N statistical thresholds, with the audit's pass bars **pre-registered** (calibrated on a held-out split, frozen before scoring).

**D.23 (resolved — post-v1 sequencing).** The first two v1.x changes are specified, in order: **(1) universal decoration coverage (D.28)** — the prerequisite — then **(2) the Greenfield POC** (roadmap Sprint 11, implementation-plan Phase 6): a small real API application built from `git init` with **zero hand-written application code** — every line through `dusk_author` + `dusk_implement`, mechanically audited via the commit-trailer record. The POC depends on (1): it produces its own `package.json`/configs through Dusk, and those comment-less files can only be decoration-covered (and so reach the POC's 100%-coverage bar) once the per-file sidecar from D.28 exists. Both precede any legacy-bootstrap investment (§8.2): greenfield is v9's native mode (decorate-at-authorship, born-decorated, never pays bootstrap), and the POC is the only validation that exercises the thesis purely, the full test pyramid against live infrastructure on real non-fixture code, and greenfield intent-tree authoring at application scale. Neither requires a deferred v1.x feature; the POC's exploratory friction data is the primary prioritization input for the rest of v1.x.

**D.24 (resolved — arch board, Phase 6 greenfield POC).** **The greenfield foundation IS authored intents, NOT an orchestration "bootstrap" phase.** When the greenfield build first surfaced that the first endpoint's bead was forced to birth the whole app foundation (db client, app bootstrap, error/response conventions, module/dir + tech-stack setup) that no intent owned, the board's first instinct was to add a foundation phase to the *pipeline* (a synthesized "foundation bead", a self-disabling "bootstrap spawn", or canonical foundation Blocks). **All such options are rejected.** They couple orchestration to bootstrap, manufacture intents no human authored, and (the Blocks variant) grow a framework tar-pit the moment a second app shape appears. The correct model is the one v9 already asserts: *the intent IS the assertion, and everything is intents*. Project/module setup, tech-stack decisions, app bootstrap, and the persistence layer are simply **the real FIRST sequence of intents** authored when starting a greenfield project — authored through `dusk_author` like any other, specific to the project, never a canonical framework. The 9-step pipeline stays general and gains no greenfield special-case. The robustness that makes this work lives in the **Author dialog** (D.25), not the orchestration.

**D.25 (resolved — arch board, Phase 6).** **The Author surfaces an unmet dependency as a general `prerequisite` tension — no bootstrap concept enters the flow.** D.10 already handles a *reactive* missing intent (the Decomposer hits an intent that does not exist mid-`dusk_implement` → pause → Author → resume). D.25 makes the Author *proactive at authoring time* by **generalizing Stage-2 tension detection to a fifth class, `prerequisite`**: tensions are detected in both directions — against intents that *exist* (conflict/overlap/gray/adjacent) and against an intent the request *depends on but that does not exist yet* (`prerequisite`). This is deliberately general — it applies to **any** unmet dependency (an endpoint needing a not-yet-authored persistence or auth intent, etc.); the greenfield foundation (an empty/near-empty tree: project/stack, app bootstrap, persistence not yet authored) is simply its **most common instance, not a special mode**. Crucially, a `prerequisite` is a *normal surfaced tension* (a non-empty `tensions[]`), so the **existing** transition handles it — the "zero tensions → advance" path naturally keeps it visible for a user decision. There is **no foundation signal, no `foundationGap` flag, and no bootstrap-specific branch in the orchestration flow** (an earlier draft added these; they were removed as flow pollution — App. D.24's principle: the currency is intents). It lands as: the `prerequisite` classification in the tension vocabulary, a general `intent_census` discovery input (what intents exist), the `prerequisite-tension` Author skill, and the Stage-2 instruction — pure dialog-agent guidance, no new orchestration.

**D.26 (resolved — arch board, Phase 6).** **A wall-clock overrun on the Engineer is a CONTINUE, never a discard-and-die — and not a transport-classified cold-retry.** The greenfield build surfaced that the Engineer's single `claude --print` spawn, when its 15-min wall clock fired on a too-large bead, threw a timeout that was classified as a *transport* failure (a null observation) → cold-retried with the identical too-large task → second timeout → the run died and the Engineer's correct partial worktree draft was discarded. Resolution: on a wall-clock timeout the spawn **resolves with a salvage marker** (the partial draft is already on disk) rather than rejecting — so the short cycle re-enters and continues from the existing files, and the overrun is never misclassified as transport noise nor cold-retried. **No per-spawn turn budget is imposed** — a `--max-turns` cap was considered and rejected: each short-cycle iteration is a fresh, memory-less spawn, so capping turns would only force the next iteration to cold-re-derive the worktree, throttling the exact file work the Engineer exists to do; the Verifier's `--max-turns 3` is the opposite case (bounding *stray* tools in a no-tools, answer-in-text context). The real root of the original over-large bead is addressed by D.24/D.25 (foundation authored as its own small intents first), so the wall clock rarely fires at all; when it does, salvage-and-continue suffices. The existing wall-clock backstop, stuckness detector, per-entry/lifetime iteration budgets, and recovery ladder (§6.4.1) remain the units of bounding and termination; the Verifier's no-leak invariant is untouched.

**D.27 (resolved — arch board, Phase 6).** **Dusk operates correctly against an external standalone repository with no remote.** v1 was only ever dogfooded *inside* the monorepo (which has `origin/main`), so three external-repo assumptions were latent: (1) `dusk init` wrote a PreToolUse hook command pointing at `$CLAUDE_PROJECT_DIR/node_modules/@dusk/pre-tool-use`, absent in a standalone repo → `computeHookCommand` now bakes the absolute installed-gate path for external repos and keeps the portable form for monorepo packages; (2) the session-snapshot base ref was the literal `origin/main` → the **default** now falls back `origin/main → main → HEAD` while an **explicit** `--base-ref` stays strict; (3) worktree creation defaulted to `origin/main` → it now **requires** the caller-resolved merge-base SHA and **fails loud** if absent (no silent default). These are external-repo generalizations (fail-loud, one construction site), not band-aids.

**D.28 (resolved — decoration board, 3 rounds; its own v1.x OpenSpec change).** **Decoration coverage is universal and language-agnostic: every file that is not explicitly ignored is fully linked to intents — inline where the format has comments, via a per-file sidecar where it does not.** Inline `// @intent` decoration only reaches comment-bearing code; comment-less formats (notably `package.json`, strict JSON) had no way to be covered, so total decoration was not actually total. Resolution:
- **One model, multiple parsers (not "two modalities").** Inline comments, the directory `.intent` file, and a new per-file sidecar all normalize to the same `DecorationRecord[]` → one derived index. The "second modality" is a third *parser*, not a parallel system.
- **Keystone fix first.** The existing directory `.intent` sidecar was parsed *only by the gate* and was invisible to the index-building scanners (the `.ts`-only `scanDecorations`/`collectSources` walkers), hence invisible to the Verifier, reverse-index, and doctor. The triplicated walkers are collapsed into **one shared `.intent`-aware scanner** so every parser's records reach `buildDerivedIndex`. This lands first, with a test that fails today.
- **Per-file sidecar `<filename.ext>.intent`** (e.g. `package.json.intent`) — reuses the already-gated `.intent` extension (zero `isGatedFile` change; auto-gated on both the live hook and the headless `gateWorktreeEdits`). Distinguished from the directory `.intent` by basename (exactly `.intent` → directory scope; a stem + `.intent` → per-file sidecar for `<stem>`). Body is JSON: `{ schema_version, target, claims:[{ anchor, marker, intent_path, aspect_ids? }], ignore:[{ anchor, because, reason }] }`.
- **Structural anchors stored; line view derived.** The stored source-of-truth is a **JSON Pointer** (RFC 6901) into the target (`/scripts/build`; `""` = whole-file); line ranges are **never stored** — they are resolved every run via a location-aware parser (pointer → AST node → line span). A **trade, not strict dominance**: immune to *positional* drift (reformatting/reordering) where inline's line model is not, traded for sensitivity to *key* drift — which surfaces as a **hard `unresolved_anchor` finding**, never a silent skip. No source-map machinery, no content hashes, no stored line numbers.
- **Computable, enforced line coverage.** "No line uncovered" is a per-run set computation: `uncovered = non-trivial-lines − covered − ignored` (blank/structural-only lines excluded). Any gap **hard-blocks** at the gate (full coverage always). Whole-file (`@intent-file` / root pointer) is the maximal tile and the floor for unstructured targets.
- **A dusk-level ignore mechanism is the ONLY exemption.** `dusk.config.yml` gains `decoration.ignore: [<globs>]` merged with project additions — the single source of truth consumed by the gate, the coverage scanner, and doctor. Defaults span three named categories (so the silent exemptions are explicit): **dependencies** (`node_modules/**`, `.git/**`), **generated/build output** (`.ia/runtime/**`, `dist/**`, `build/**`, `coverage/**`, `**/*.lock`), **secrets** (`.env*`) — this set IS the honest boundary of "total." It **replaces all three hardcoded skip sets** that exist today (`context.ts`, `project.ts`, `doctorStaticAnalysis.ts`), not only the doctor's. Distinct from the per-claim `@intent-ignore` marker (a documented region *within* a covered file). The generated-file line follows a **principle**: checked-in + meaningfully authored (`package.json`, configs, migrations) → covered via sidecar; pure build output (`dist/`, lockfiles) → ignored. Everything not glob-ignored must be fully covered or it fails the gate.
- **Config is verified mechanically/structurally** (anchor resolves + coverage tiles + the existing Stage-2 build/test), **never** routed to the semantic Verifier — a manifest has no architectural triple to judge; records are tagged `verify: "structural"` so the semantic path skips them **at the index boundary** (not merely the prompt). The exclusion covers **all four** semantic consumers — `focalSupport`, `aspectRollup`, `isSatisfied`, and the `compose: implies` antecedent gate (`antecedent.ts`, which reads records raw with `scope:"file"` predicates) — else a config claim would silently fold into the semantic satisfaction metric or satisfy a semantic antecedent. The public derived-index `records` set stays the **full** merged set (structural records remain visible to the reverse-index, `dusk_inspect`, and doctor — the keystone's purpose); the semantic/structural split is an internal partition those four consumers read. Never blended into semantic adherence. *Accepted limitation (recorded):* this verifies presence + anchoring, not the correctness of the intent↔region binding (config has no triple to judge) — a deliberate trade of keeping config off the semantic channel.
- **Gate surface:** the change adds five mechanical rejection kinds (`malformed_sidecar`, `sidecar_target_missing`, `unresolved_anchor`, `overlapping_anchors`, `uncovered_target_lines`) that extend the gate's documented rejection set (App. A.8).
- **Scope: JSON-only** sidecars for now (whole-file fallback for any other comment-less format); not a general any-format region map (the named over-engineering trap). This is a **prerequisite** for a fully decoration-covered greenfield POC and is built before the POC restart.

**D.29 (resolved — arch board, Phase 6 greenfield POC).** **A structural triple is satisfied on a MECHANICAL Verifier channel — it never reaches the semantic LLM, so it converges on iteration 1.** D.28 correctly partitions `verify: "structural"` records *out* of the four semantic consumers, but that exposed a satisfaction gap the POC immediately hit: building the first all-config intent (`project/typescript-esm-foundation`, owning `package.json`/`tsconfig.json`/`vitest.config.ts`) **looped ~6 short-cycle iterations and never converged**. The diagnosis was precise — *coverage passed* (the sidecars tiled the files fully), but a triple whose only claimant is a structural record has **no semantic evidence**, so the LLM Verifier's `affirmative_holds ?? false` defaulted it to `focal_verdict: "fail"` (`procedure.ts`), the short cycle re-drafted, and the Engineer could never manufacture a *semantic* pass for a triple that has *no semantic claimant by design* → infinite re-draft until budget. The currency is intents, and config IS intents (D.24) — so config must be *satisfiable*, not just coverable. Resolution (board unanimous):
- **A zero-LLM structural Verifier (`structuralVerdict`, `packages/runtime/verifier/src/structural.ts`).** For each triple with a structural focal claimant it emits `focal_verdict: "pass"` iff the sidecar anchor resolves against the live target AND the target is fully decoration-covered; a dangling anchor or uncovered line yields `"fail"` with an actionable rationale; a triple with *no* structural claimant fails as an uncovered aspect (never a silent pass). It reuses the **same primitives as the pre-tool-use gate** (`parseFileIntentSidecar` + `computeSidecarCoverage`) so the gate and the Verifier can never disagree on coverage. A structural-only intent thus converges on the **first** iteration with **zero** model calls.
- **Channel routing in the `verifierFactory`** (mirroring the existing test-pre-pass route). Two new index classifiers — `structuralAspects` / `semanticAspects` — partition an intent's triples by claimant kind. All-structural → `structuralVerdict`. All-semantic → `verifyIntent`, **unchanged**. **Mixed** → run both and merge per `triple_id` (`mergeStructuralSemantic`): a triple claimed both ways must pass **both**; a structural-only triple takes the structural verdict; a semantic-only triple takes the semantic verdict.
- **Honesty, not a new verdict state.** A 3-`focal_verdict` enum (`pass`/`fail`/`structural`) was considered and **rejected** as an over-engineering trap that would ripple through every verdict consumer and the short cycle. Structural-satisfied is a plain `pass`; the mechanical-vs-semantic distinction is carried by an **additive optional** `channel: "mechanical" | "semantic"` field on `PerTripleVerdict` (absent ≡ `semantic`). Adherence reporting keeps the channels separate — a structural pass means "covered + anchor-resolves," never "an LLM judged the architecture."
- **The short cycle and the semantic Verifier are UNTOUCHED.** `loop.ts` already converges on "no failing triple"; it now sees passes for structural triples instead of permanent fails. No `--max-turns`, no compile/build moved into the structural channel (that stays Stage-2's job) — `structuralVerdict` is strictly coverage + anchor resolution.

**D.30 (resolved — arch board, Phase 6 greenfield POC; first-principles re-audit).** **The verification channel is a property of the CLAIM, declared by the AUTHOR on the triple — NOT derived from the decoration modality (file format).** Re-running the foundation build after D.29 surfaced that D.29's fix was incomplete: the `verify` channel was sourced 100% from *which parser produced the record* — `parseDecorations.ts` always stamps `semantic`, `parseFileIntentSidecar.ts` always `structural`. Those were correlated only by accident (until now, only comment-less files were structural). The greenfield POC broke the correlation: `vitest.config.ts` is a comment-bearing **config** file → D.11 forces inline decoration → forced onto the **semantic** channel, where a config file has no behavioral triple for the LLM to judge (vitest is native-ESM by *default* — the evidence is an absence), so the short cycle churns and never converges. The board (architect, backend, AI eng, Fowler) converged: the channel is a property of *what is being claimed* ("is there behavior to judge?"), and modality (sidecar vs inline) is only about *how the code is anchored*. Resolution:
- **`verify: "structural" | "semantic"` is declared on the triple** (`TripleSchema`, `core-schema/primitives.ts`), default absent. The author decides it at authoring time, in version-controlled YAML — the only honest locus. (A *decorator*-declared channel — an inline marker the Engineer emits — was **rejected**: the Engineer is the solver under a re-draft incentive and could downgrade a failing semantic claim to structural to escape the verdict. The author has no stake in the verdict.) No new decoration marker is added (the inline `@intent` link is unchanged); the channel comes from the triple.
- **Channel resolves triple-first** (`derivedIndex.ts` `structuralAspects`/`semanticAspects`): an explicit `triple.verify` is authoritative; absent, it falls back to decoration modality (sidecar→structural), preserving every existing comment-less-config intent (D.28). So a comment-bearing config file an author marked `verify: structural` routes structurally even though its inline record was stamped `semantic` by the parser.
- **`structuralVerdict` gains an inline-backed path** (`runtime/verifier/structural.ts`): a structural triple decorated inline (no sidecar) is verified by *presence* — its claimant resolving in the live worktree index IS the anchor; the `.ts` file's line-coverage is already enforced by the gate — not by the JSON sidecar primitive. Sidecar-backed structural triples keep the coverage-tiling path. Zero LLM either way; a config intent (comment-bearing or not) converges iteration-1.
- **The vacuous-pass / no-subject problem** (a behavioral triple like "source imports carry a `.js` extension" swept into a config intent by a whole-file sidecar claim) is resolved at the **authoring layer**: an explicit `verify: semantic` keeps such a triple on the semantic channel (an author override beats the modality fallback, so a whole-file structural claim can no longer sweep it), and it then fails honestly for lack of a real claimant — telling the author it is misplaced. The Stage-4 drafting guidance + the `dusk/author/verify-channel` skill elicit the channel per triple (litmus: "can you point at a declaration whose mere existence makes it true?"), so dusk *produces* correct channels rather than patching them later.
- Honesty preserved: a structural pass still means only "covered + present" (`channel: "mechanical"`); mechanical and semantic are never blended; `mergeStructuralSemantic` still reports a both-ways triple as `semantic`. D.29's machinery is unchanged and now reachable for comment-bearing config — D.30 completes D.29 for the case it didn't anticipate.

**D.31 (resolved — arch board gap-hunt, Phase 6).** **The structural channel must be as HONEST as the semantic one: a mechanical pass may never assert something false, and no silent wrong verdict may survive.** After D.29/D.30 landed the structural channel, a first-principles board gap-hunt (4 members) found that `structuralVerdict` was built as a coverage-presence checker but never inherited the semantic channel's correctness machinery, opening several honesty holes. Fowler's counter-review pruned the maximalist list to the cases where a pass means something FALSE or a verdict is silently wrong; the chair's synthesis fixes exactly those:
- **`structuralVerdict`/`mergeStructuralSemantic` honor `compose`** via the SAME `aggregateDecision` the semantic path uses — the structural path had hardcoded `all` semantics, so a `compose: none` intent's verdict was **inverted** (it accepted when it should reject) and `any` was mis-decided. Single-sourced, both channels.
- **`compose: implies` antecedent is evaluated on the structural channel** (reusing `resolveUnit`/`evaluateAntecedent`, zero-LLM): an implication whose antecedent does not hold is a vacuous accept; previously the structural path demanded the consequent unconditionally.
- **The structural channel can verify neither an ABSENCE nor a CARDINALITY**: a `verify: structural` triple with `polarity: negative` (coverage proves presence, never absence) or with a `quantifier` (coverage cannot count) is now **rejected at authoring time** by a new `validateVerifyChannel` primitive wired into both Stage-4.5 (`validateDraft`) and `dusk validate`, with a `verify-channel` skill hint. `structuralVerdict` additionally **fails loud** (never a vacuous pass) as a runtime backstop if such a triple ever reaches it. (This guard immediately caught a real misclassification in the POC foundation — a negative `no-runtime-deps-in-dev` marked structural — which was reframed as a positive shape claim.)
- **Schema hardening**: a sidecar claim's `aspect_ids` must be non-empty when present (`[]` silently claimed nothing); `mergeStructuralSemantic` fails loud on an unclassifiable triple rather than leaking `undefined`.
- **Explicitly NOT built** (Fowler, accepted): a structural-negation evaluator, quantifier-on-structural semantics, a subject-resolution static analyzer, a channel-inference engine, a third channel value, a fuzzy "behavioral-subject" heuristic bounce, or mandated per-triple sidecar anchors. The whole-file `intent-file` sweep is an honest *coarse* claim (the file IS covered), not a false one, once negatives are rejected — so per-triple anchoring stays opt-in. "Completely" here means **no dishonest structural pass and no silent wrong verdict remains**, not gold-plating every theoretical edge. Deferred (surfaced, not silent): making `verify` mandatory so the modality fallback is never load-bearing.

**D.32 (resolved — arch board, Phase 6 greenfield POC; investigate→debate→converge).** **Test-pyramid identity is routed by the AUTHORED PATH SUFFIX, not by the decoration marker; the marker's job is to locate the test BODY, not to decide test-ness.** Continuing the D.29–D.31 series, the POC build surfaced that "is this a test intent?" was decided two inconsistent ways: by the authored suffix (`…/unit-tests`, per `test_pyramid.suffixes`) in the orchestrator + `dusk_inspect`, but by the `@intent-test`/`@intent-test-file` *marker* (`testDiscovery`) in the CLI verifier, the Stage-1 pre-pass, and the Test Runner. An Engineer — never taught the test markers exist (`ENGINEER_FILE_INSTRUCTION` and every `dusk/engineer/*` skill name only `intent`/`intent-file`) — decorated test files with `@intent`, so `testDiscovery` was empty and the verifier **silently fell through** to ordinary verification, where a test-pyramid intent's `covers-*` triples were judged with no notion of test falsifiability — so a tautological / mock-only / never-failing test could be **silently accepted**, defeating §3.4. This is the **D.30 principle on a new axis** (a routing decision follows an authored property of the claim, not a fallible decoration artifact). Resolution:
- **Route by suffix (root fix).** The verifier routes a test-suffix intent to the Stage-1 pre-pass on the authored suffix, never on `testDiscovery` non-emptiness — so a test-suffix intent can never fall through to ordinary verification. One shared suffix predicate is used by the verifier, the orchestrator, and inspect (collapsing the two-way inconsistency to a single source of truth).
- **Suffix and marker answer two questions.** Suffix → *is this a test intent?* (identity/routing, authored). Marker → *which file is the test body?* (evidence location, Engineer-supplied, required). The marker is genuinely load-bearing (a suffix cannot name a file) — so "derive routing from suffix and drop the marker" is **rejected**; this is the precise boundary where the D.30 analogy stops (D.30 governs routing, has no evidence-location component).
- **Fail loud, legibly.** A routed test intent with no test-marker body fails with a specific `test_intent_no_test_marker` signal (naming the intent + the expected markers), never a silent skip and never the generic "test does not verify" — so the short cycle can self-correct.
- **Reverse of gate Check 9.** A focal claimant (`intent`/`intent-file`) whose `intent_path` is a test-suffix intent is rejected (`non_test_marker_on_test_intent`) at write time — the mechanical guarantee the body-locating marker is present. Scoped exactly: it fires only on the focal claim *of the test-suffix intent itself*; `@intent-support`, and `@intent` claiming a *non-test* intent inside a test file, stay legitimate. Forward Check 9 unchanged; the pair enforces *test-suffix intent ⟺ test-marker claimant present*.
- **Teach the Engineer.** The instruction + a `dusk/engineer/*` skill name the test markers; the per-bead task signals "this is a test bead." Routing + gate make failure honest and mechanical; guidance makes the common case succeed (it is a rate-improver, never a correctness guarantee). **Orthogonal to D.29/D.30/D.31:** test routing is a *prior* fork (which instrument); structural-vs-semantic is *within* the ordinary path — no third `verify` value is added. Its own v1.x OpenSpec change (`test-pyramid-routing`); lands before the Phase-6 POC resumes.

Items genuinely still open: **D.4** (heterogeneous models — now framed as a Sprint-9 tier-down optimization per D.21), **D.15** (canonical test-intent triples), **D.16** (polyglot test runner).

---

## Appendix E: Reading Order for Implementers

| Sprint | Read | Why |
|---|---|---|
| 1 | Ch. 1, Ch. 2 (sections 1-3, 7-9), App. A.1-A.3 | Mental model + non-test artifacts + file format |
| 2 | **Ch. 4 (entire)**, App. A.2, App. A.8 | **The decoration model is the v9 core. Read end-to-end before sprint work.** |
| 3 | Ch. 3, App. A.4 | Triples + Verifier I/O |
| 4 | Ch. 2 sections 4-6, App. A.5 | Test pyramid encoding + Test Runner I/O |
| 5 | Ch. 5 | Intent authoring sub-flow |
| 6 | Ch. 6 | Implementation pipeline (the big chapter, now 9 steps) |
| 7 | Ch. 9 | Sub-agent roles, memory, skills |
| 8 | Ch. 10 | Integration surface (MCP, slash commands, harness contract) |
| 9 | Ch. 7 | Verifier model + observability |
| 10 | **App. B** | **The canonical worked example. Reference repeatedly during Engineer / Verifier role prompt authoring.** |
| 11 | Ch. 8, App. C, App. D | Deferred features + v8→v9 migration context + open decisions |

Total document length: ~1,400 lines (v8 was ~1,000; v7 was ~900). The decoration chapter (Ch. 4) and the worked example (App. B) account for most of the growth.

---

## Closing Note

v9 closes the gap v8 left implicit: **the system is silent about no category of code.** Every statement, every block, every test has explicit decoration. The Verifier's evidence set is scoped per aspect, not "the function body." Cross-cutting concerns are visible on the functions that touch them. Tests are first-class child intents, not side artifacts.

The honest stance hardens: **Dusk is the implementation framework, and code is written for AI consumption.** Verbosity that would be over-engineering in a human-authored codebase is the right trade-off here. The traditional readability objections are arguments for an audience that no longer exists. The author is an AI; the reviewer is an AI; the maintainer is an AI. The decoration system, with its inline triples and its per-statement claims, is the language they share.

The conceptual savings from v9, beyond v8's collapses, are about removing ambiguity:

- **Implicit coverage is gone.** Every statement declares its role.
- **The focal/support distinction replaces "where does the aspect happen?"** The decorator answers it.
- **Test pyramid integration replaces "did anyone write tests?"** The intent satisfaction surface includes them.
- **The memory configuration replaces "trust the prompt to be fresh."** The runtime enforces it.

What's left to keep right in v9 builds on v8's four load-bearing items and adds two more:

1. **Triples are crisp assertions, not paragraphs in three boxes.** (v8)
2. **Engineer and Verifier truly run in independent contexts.** (v8) — now enforced via `memory:` frontmatter, not implicit.
3. **The affected universe for shuffle sharding is correctly computed.** (v8)
4. **The PreToolUse gate hard-blocks every write that fails the mechanical checks.** (v8) — now 10 checks (12 typed rejection kinds), including decoration completeness. The agentic decorate-or-decompose check is intentionally NOT in the gate; the mandate is enforced via Engineer proactivity + Verifier surface area.
5. **The Engineer applies the decorate-or-decompose mandate proactively.** (v9) — code is structured so every unit's intent participation is covered by its decoration; sub-operations whose intent participation diverges are extracted to their own decorated units. The PreToolUse gate (check 8) catches edge cases; the Engineer's skill set drives the discipline.
6. **`@intent-support` triples accurately describe their statements.** (v9) — vague or wrong triples produce false-positive support claims that mislead verification. The Verifier flags low-confidence support claims; the Engineer iterates.

Build for right. Land the plane.
