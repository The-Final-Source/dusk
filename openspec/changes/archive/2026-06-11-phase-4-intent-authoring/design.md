## Context

Phase 4 is the **loop-closing phase**. It's substantially smaller than Phase 3 (one continuation state machine vs the 9-step pipeline) but lives at three integration points Phase 3 left stubbed: the Decomposer's unresolved-intent escalation, Recovery Ladder L2's recovery action, and the livelock `modify_triple` verb resolution. Each of those three points was deliberately shipped against a **frozen interface** in Phase 3 (`ImplementCheckpoint`, `intent-proposal.yaml` + `bead_intent_revision_needed`, `TestVerifierLivelockReport.failing_triple`) so Phase 4 can wire the real Author flow into them without reshaping anything upstream.

The constraints are sharp: Stage 4.5 validations must use the **same parser primitives** Phase 1's `pretooluse-gate` uses (one source of truth for negation/antecedent/relates-to rules — anything else creates a drift surface where a triple could pass the Author but fail the gate, or vice versa). The 5-stage flow must surface **every user decision as a real branching point** — no synthetic "do you accept?" yes/no over a baked-in choice; the Author proposes, the user picks, and the dialog branches on the pick. The pause/resume loop must close: `dusk_implement` pause → `dusk_author_*` finalize → `dusk_implement` resume must work against the same `ImplementCheckpoint` shape Phase 3 froze, with `suggested_dialog_seed` content enriched but the JSON shape unchanged. And no embeddings, no vector search, no runtime canonical-library lookup — Stage 2 is grep-only and Stage 3 is training+skill only (RFC §8.10 / §8.11).

The dependency story is favorable: every Phase-4 capability binds to seams shipped in earlier phases. There's no new "machine the Author needs that doesn't exist" — Phase 2 shipped the Author role file + memory: dialog + 7 baseline skills; Phase 3 shipped the checkpoint shape, the livelock report, the L2 artifact + recoverable error. Phase 4 is wiring.

## Goals / Non-Goals

**Goals:**

- Define the 5-stage state machine as a typed transition function that surfaces every user decision as a branching point, including Stage 1's framing-loopback, Stage 3's greenfield rejection branch, and Stage 4.5's bounce-back on parser violations.
- Define `DialogState` as the frozen cross-proposal interface Phase 5's audit will consume, persisted on disk so dialogs survive harness crashes / process restarts.
- Define how Stage 4.5 imports Phase-1 parser primitives (one source of truth — no rule duplication).
- Define `suggested_dialog_seed` enrichment as a pure transform — making the Decomposer-Author bridge deterministic and unit-testable.
- Define the `modify_triple` rewire from Phase-3's inline-payload form to a scoped single-stage continuation.
- Define the L2 recovery action — how `intent-proposal.yaml` feeds the Author Stage 3 injection.
- Define a `ScriptedAuthorResponse` test seam — the Phase-4 analog of Phase 2's scripted-verdict double — so control-flow tests run deterministically without LLM cost.
- Define atomic Stage 5 finalize semantics including partial-failure rollback.
- Pin all Phase-4 cross-change interface seams for Phase 5.

**Non-Goals:**

- Fresh-Verifier audit, `/dusk-doctor --static-analysis`, observability sinks, benchmark harness, seeded-violations fixture, dogfooding on real packages. Phase 5.
- Any embedding/vector/RAG substrate. Stage 2 is grep-only per RFC §8.10.
- Any runtime canonical-library lookup. Stage 3 uses training + skill per RFC §8.11.
- Reshaping any Phase 1/2/3 capability — `ImplementCheckpoint`, `TestVerifierLivelockReport`, the L2 artifact contract, the bead memory format, every read/write path is consumed as-is.
- App-package code — untouched.

## Decisions

### D1 — The 5-stage flow is a typed transition function

The Author runtime exposes a pure transition function:

```typescript
type AuthorTransition = (
  state: DialogState,
  response: UserResponse,
) => { nextState: DialogState; outcome: TransitionOutcome };

type TransitionOutcome =
  | { kind: "ask"; question: string; stage: AuthorStage }
  | { kind: "finalize_ready" };
```

Each `AuthorStage` (`1 | 2 | 3 | 4 | "4.5" | 5`) has its own transition handler. The branching points are first-class transitions, not exceptions:

- **Stage 1 framing loopback (P4-T11):** if `response.kind === "reject_framing"`, the transition stays at Stage 1 with a regenerated framing question — does NOT advance to Stage 2.
- **Stage 2 tension resolution (P4-T2):** the discovery pass surfaces zero-to-N tensions classified `conflict | overlap | gray | adjacent`; the next question asks the user to pick a resolution per tension; the pick branches into Stage 3 with the encoded resolution in `intents_drafted` scaffolding.
- **Stage 3 greenfield (P4-T12):** if `response.kind === "reject_practice_proposal"`, the transition advances to Stage 4 with NO scaffold (greenfield draft from the user's Stage 1 framing alone) — no canonical-library fallback, no fabricated match.
- **Stage 4.5 bounce-back:** if any drafted triple fails the parser primitives (D3), the transition returns to Stage 4 with the failing triple + skill-hint as the next question — Stage 5 never sees a non-validating intent.
- **Stage 4 → 4.5 → 5 transition:** Stage 4 finalize-intent → automatic 4.5 pass → if green, transition to Stage 5; if red, bounce to Stage 4.
- **Stage 5 finalize:** Stage 5 is non-interactive — it writes the validated intents atomically and the outcome is `finalize_ready`. `dusk_author_finalize({dialog_id})` is what actually triggers the writes.

The transition function is pure (no I/O); it consumes `DialogState` and a `UserResponse`, returns `{nextState, outcome}`. The runtime wraps it with the LLM call (to generate `next_question` text in the outcome) and persistence (to write the new `DialogState` to disk).

**Alternative considered:** an OO state-machine class with per-stage instances. Rejected — closure-and-pure-function matches the project's "factory functions over classes" coding standard, and a pure transition function is trivially unit-testable.

### D2 — `DialogState` persisted as YAML frontmatter + Markdown transcript (mirrors bead memory format)

The disk format at `.ia/runtime/dialogs/<dialog-id>/state.md` is YAML frontmatter + Markdown sections, mirroring Phase 2's bead memory format for consistency. The Zod schema in `@dusk/core-schema` defines the shape:

```typescript
type DialogState = {
  schema_version: 1;
  dialog_id: string;            // dlg_<14-digit-ts><3-digit-seq>
  request: string;              // the original Stage-1 input
  current_stage: 1 | 2 | 3 | 4 | "4.5" | 5;
  transcript: TranscriptEntry[]; // every turn, both sides
  intents_drafted: Intent[];     // accumulating draft (validated only at 4.5)
  created_at: string;            // Clock-injected ISO 8601
  last_touched_at: string;       // bumped on every continue
};

type TranscriptEntry = {
  role: "author" | "user";
  content: string;
  stage: AuthorStage;
  at: string;
};
```

Round-trip is deterministic (canonical YAML field order; the transcript renders as sequential `## Turn N` Markdown sections). Phase 5 audit reads the `transcript` to inspect human-Author negotiation.

**Alternative considered:** in-process state with a TTL log. Rejected — survival across harness crashes is required (a `dusk_author_continue` call may happen minutes after `dusk_author_start`); disk is the only correct backing.

### D3 — Stage 4.5 imports Phase-1 parser primitives (single source of truth)

Stage 4.5 SHALL NOT reimplement any validation rule. The Author runtime imports directly from `@dusk/core-parser`:

- `validateMatrixPredicateNegation(triple)` — the matrix/constituent rule (Phase-1 `negation-detector`).
- `validateAntecedentGrammar(intent)` — closed-vocabulary + resolvable references for `compose: implies` (Phase-1 `intent-parser`).
- `validateRelatesToKinds(intent)` — five typed kinds with no `refines` (Phase-1 `intent-schema` schema).
- `validateAtomicIntent(intent)` — full v2 schema validation including path-to-id rule (Phase-1 `intent-parser`).

If any check returns a violation, the runtime SHALL produce a Stage-4.5-bounce outcome carrying the violation's `code` + a skill-name hint (`polarity-decision` / `implies-antecedent-grammar` / `typed-relates-to`). The Author then drafts a corrected triple and re-enters 4.5.

**Rationale:** parser rule drift is a known failure mode in spec-driven systems where two surfaces (Author + gate) each have their own copy of the validation logic. Single source of truth eliminates drift by construction.

### D4 — `suggested_dialog_seed` enrichment is a pure transform

The Decomposer-Author bridge (the `bead-decomposition` modification) replaces Phase 3's naive `suggested_dialog_seed = unresolved_refs.join(", ")` with a pure-function enrichment:

```typescript
function enrichDialogSeed(
  unresolvedRefs: string[],
  snapshot: IndexSnapshot,
): string;
```

The function reads the snapshot for each unresolved-ref's surrounding context — parent intent, sibling intents, `relates_to`-linked intents, the request that introduced the reference — and produces a Stage-1 framing prompt naming what's missing in business-vocabulary terms (not just paths). Pure → deterministic → unit-testable; the Phase-3 `ImplementCheckpoint` shape stays unchanged.

**Example.** Naive (Phase 3): `"api/pagination/cursor-only/cursor-encode"`. Enriched (Phase 4): `"The 'add cursor encoding for paginated lists' request references an intent 'api/pagination/cursor-only/cursor-encode' that doesn't exist. Its parent 'api/pagination/cursor-only' covers cursor decoding (api/pagination/cursor-only/cursor-decode) but not encoding. Please describe the encoding behavior you want."`

### D5 — `modify_triple` dialog reuses the 5-stage runtime in single-stage mode

Phase 3's `dusk_resolve_livelock({verb: "modify_triple", payload: {edited_triple}})` accepted an inline edited triple — a deliberate Phase-3 stub. Phase 4 rewires the verb to invoke `dusk_author_start` with a **single-stage seed**: the `failing_triple` from `TestVerifierLivelockReport` pre-loaded as the Stage-4 draft, with the dialog short-circuited past Stages 1–3.

Implementation: a new `AuthorEntryMode = "full" | "scoped_triple_edit"`. In `"scoped_triple_edit"` mode, `dusk_author_start` skips Stages 1–3 entirely and produces an initial state at Stage 4 with the failing triple pre-loaded. Stage 4 + 4.5 + 5 run as normal. Stage 5 finalize writes the edited triple back into the existing intent file in-place (via `core-parser`'s atomic write) — does NOT create a new intent.

**Phase 3 form deprecated, not maintained.** Phase 3's inline-payload form is hard-removed in this change (the `payload` parameter on `dusk_resolve_livelock` is dropped); the contract is now uniformly "modify_triple opens a dialog." This is acceptable because nothing outside Dusk is consuming the v1 surface yet — Phase 3 is internal-only.

### D6 — L2 recovery action consumes `intent-proposal.yaml` via Stage 3 injection

When the user invokes `dusk_author_continue` against an L2-error bead's `intent-proposal.yaml`, the proposal becomes the input to a Stage 3 transition — the proposal *is* the "practice proposal" the Author would otherwise generate from training. The user can accept (proceed to Stage 4 drafting per the proposal), reject (greenfield, per the P4-T12 branch), or selectively accept (the user-picks-from-options branch).

Implementation: a new `AuthorEntryMode` extension `"l2_recovery"` that takes a proposal file path as a parameter; the runtime synthesizes a Stage-3 outcome with the proposal pre-populated as the practice-proposal content. From the user's perspective, this is just a normal Stage 3 continue — they don't need to know the proposal came from a recovery file.

After Stage 5 finalize writes the revised intent file, the user re-invokes `dusk_implement({request: <original>})` to retry the bead. The bead's previous deferred state is NOT auto-restored — the user is responsible for re-invoking `dusk_implement`. This is honest: the L2 recovery has produced a refined intent; running the bead again is a separate user decision.

### D7 — Stage-script driver test seam (analog of Phase 2's scripted-verdict double)

Control-flow tests need to drive the 5-stage runtime deterministically without LLM cost. The seam is injected at the Author runtime's spawn boundary (mirroring Phase 2's `verifierFactory?` on `spawnSubAgent`):

```typescript
type AuthorRuntimeOptions = {
  scriptedAuthorResponses?: ScriptedAuthorResponse[];
};

type ScriptedAuthorResponse = {
  expectStage: AuthorStage;
  question: string;          // the next_question the Author "would have generated"
  draftPatch?: Partial<Intent>; // what the Author drafts at Stage 4
};
```

When `scriptedAuthorResponses` is provided, the runtime consumes them in order — for each `continue` call, the next scripted response replaces what the LLM would have produced. The `UserResponse` itself still comes from the test (this is how the test exercises branching: it scripts the Author's questions/drafts and provides scripted user answers).

When the script is exhausted, the runtime returns a typed error (analog of Phase 2's `internal_error` "script underran"). No silent fallback to the real LLM.

This is the test surface for P4-T1, P4-T3, P4-T6, P4-T7, P4-T8, P4-T9, P4-T10, P4-T11, P4-T13. The LLM-content tests (P4-T2, P4-T4, P4-T5, P4-T12) run against the real frontier model with `N=3 ≥2/3`.

### D8 — Stage 5 finalize is atomic across multiple intent files

A single dialog may draft multiple intents (impl + test-pyramid children + a `compose: implies` conditional, per the smoke scenario). Stage 5 finalize SHALL write all files via `@dusk/core-parser`'s atomic write (`write to temp + rename`); if any single write fails, ALL pending writes SHALL be rolled back (temp files deleted) and the dialog SHALL be preserved (NOT destroyed). The error envelope SHALL be `DuskError{kind: "author_intent_schema_invalid", details: {failed_intent_path, reason}, recoverable: true}` — the user can fix and re-finalize.

**No partial commits.** Either all intent files land or none. This matches Phase 3 Recovery Ladder L1's "deferred intents are explicit" stance — Phase 4 doesn't have an analog of "partial finalize" because authoring is a single atomic transaction from the user's perspective.

### D9 — Cross-change interface seams pinned by Phase 4

In `@dusk/core-schema`:

- **`DialogState`** — the disk-persisted dialog shape Phase 5 audit reads.
- **`AuthorEntryMode`** — `"full" | "scoped_triple_edit" | "l2_recovery"`. Phase 5's audit may discover dialogs in any of these modes.
- **`AuthorDuskError` kinds** — Phase 2 reserved `author_dialog_id_unknown`, `author_stage_invalid_response`, `author_intent_schema_invalid`. Phase 4 adds `author_finalize_partial_failure` (Stage 5 rollback case) + `author_l2_proposal_unreadable` (L2 entry with a malformed proposal file).
- **`dusk_resolve_livelock` contract change** — the `payload` parameter is removed; the call signature is now `{bead_id, verb, dialog_init?: {... }}` where `dialog_init` carries entry-mode hints when relevant. Phase 5 audit binds to the new shape.

## Risks / Trade-offs

- **[Stage 4.5 rule drift between Author + gate]** — handled at construction by D3 (single source of truth). If a new rule lands in Phase 5, both surfaces see it on the next compile.
- **[Dialog disk pressure]** — abandoned dialogs accumulate. **Mitigation:** Phase 3's `dusk doctor --gc-dialogs` is already operative on the 24h window (P4-T10).
- **[`modify_triple` Phase-3 callers break]** — the `payload` parameter is removed. **Mitigation:** Phase 3 is internal-only (nothing outside Dusk consumes the v1 surface yet); the change is documented in the proposal as a hard cutover. If a v1.x adopter needs a deprecation path, we can re-add a compat shim — but for v1 we drop it.
- **[Real-model-cost in CI]** — LLM-content tests use real frontier model calls. **Mitigation:** same pattern Phases 2/3 use — verdict-correctness suite gated behind `DUSK_RUN_CORRECTNESS=1 pnpm test` (nightly), control-flow suite (scripted-author-driver) runs on every PR.
- **[Dialog lifecycle race on `finalize`]** — a `continue` and `finalize` arrive concurrently. **Mitigation:** the runtime takes a per-`dialog_id` advisory file lock during state writes (the same Phase-1 atomic-write semantics); concurrent calls serialize. If a `finalize` races a `continue`, the loser returns `author_dialog_id_unknown` (the dialog was destroyed by the winner) or proceeds against the new state (the continue arrived first).
- **[L2 proposal author entry binds to a Phase-3 artifact format]** — `intent-proposal.yaml` shape is owned by Phase 3's `recovery-ladder`. **Mitigation:** Phase 4 imports the proposal's shape from `@dusk/core-schema` (Phase 3 placed it there); a Phase-3 shape change would break Phase 4's parser — but no such change is planned, and the audit catches breakage immediately.

## Migration Plan

Phase 3 is archived. Phase 4 lands as a single change with no production-data migration: `.ia/runtime/dialogs/` is not yet in use (no `dusk_author_*` flow exists); `dusk_resolve_livelock` is internal-only so the `payload` removal is invisible to v1 users. The Author role file at `.claude/agents/dusk-author.md` shipped in Phase 2 with `memory: dialog` declared; Phase 4 wires the actual `dialog` materializer to consume `DialogState`. Rollback = `git revert` of the merge commit (no on-disk persistent state to clean).

## Open Questions

- **Q1 — Stage 2 grep over `.ia/intents/`: full-text or AST-aware?** Stage 2 needs to surface tensions against existing intents. **Resolution:** full-text grep using ripgrep against `intent.yaml` files (filtering by description + triple object/predicate slots), with results post-processed through a frontier-model classifier (`conflict | overlap | gray | adjacent`). No AST awareness needed in v1 (the YAML shape is shallow). Rationale: matches RFC §8.10's "grep-only" stance; AST awareness is a v1.x optimization if performance demands it.
- **Q2 — Stage 3 industry-practice content source.** The Author's "industry practice" comes from training (the model's pre-trained knowledge) and the `dusk/author/best-practices-application` skill. **Resolution:** the skill file is content-loaded (Phase 4 fills it with concrete decomposition patterns for cursor pagination, idempotency-on-writes, observability-on-cross-cutting-concerns, etc. — the same patterns Phase 5's seeded-violations fixture will reference). No runtime fetch.
- **Q3 — `modify_triple` against an in-flight bead: does the bead stay paused or is the dialog out-of-band?** The bead pauses while the user drives the dialog; on `dusk_author_finalize`, the bead's next-iter Verifier spawn picks up the refreshed intent. **Resolution:** in-band — the `dusk_implement` invocation that hit the livelock waits for `dusk_resolve_livelock` to return. (Phase 3 already pauses the bead for resolve; Phase 4 just lengthens the wait to include the dialog turns.)
- **Q4 — Slash command vs MCP tool surface uniformity.** `/dusk-author` is a slash command wrapper around the 3 MCP tools. **Resolution:** `/dusk-author <request>` calls `dusk_author_start({request})` and prints the `next_question`; `/dusk-author --continue <dialog_id> <response>` calls `dusk_author_continue`; `/dusk-author --finalize <dialog_id>` calls `dusk_author_finalize`. Matches Phase 2's `/dusk-test` pattern of slash being a thin wrapper.
