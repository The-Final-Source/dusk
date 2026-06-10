## Context

Phase 1 shipped pure deterministic substrate — no model in the loop. Phase 2 introduces the first model-dependent surfaces: the Verifier procedure (§3.3), sub-agent spawn via Claude Code's Task tool (§9.9), the read-path MCP surface, and the test infrastructure that makes Phase 3's control-flow tests possible (the scripted-verdict Verifier double, deferred from Phase 1's design D7). Several decisions here become cross-phase seams — the assembled spawn payload shape, the bead-memory file shape, the Verifier output shape, the test-double pluggability seam, and the `raw_prompt` capture surface — and bind every later phase to this design. They must be pinned now and held stable.

The constraints are sharp: the Verifier procedure must keep negation out of the LLM call (runtime polarity inversion); it must evaluate `compose: implies` antecedents by deterministic index lookup without spending a token; the per-triple verdict must split focal correctness from support-decoration quality without conflation; the Verifier's spawn payload must structurally exclude the Engineer's diagnosis (the round-3 board fix); and every behavioral test must pass against real dependencies — real MCP server, real file system, real frontier model for verdict correctness, scripted-verdict double for spawn/asymmetry/compaction. Phase 3 cannot start until these properties hold cohesively.

## Goals / Non-Goals

**Goals:**

- Define the spawn pipeline that materializes role + memory + skills into a single assembled system prompt, calls Claude Code's Task tool with `subagent_type: dusk-<role>`, and emits a `SubAgentTrace` with the test-mode `raw_prompt` field (App. A.6).
- Define the bead-memory file format (dual-channel, structured, mechanical-compaction-friendly) and the diagnosis-routing guarantee (diagnosis never appears in any Verifier-spawn payload).
- Define the Verifier procedure end-to-end at `temperature: 0` — scoped focal+support evidence assembly, deterministic-index-lookup antecedent evaluation, affirmative prompt construction, runtime polarity inversion, per-support `triple_verdict` extraction, `support_quality` aggregation, `compose` aggregation, and the `Verdict` output shape (App. A.4).
- Define the scripted-verdict Verifier double + spawn-counter telemetry — the test seam Phase 3 binds to for every control-flow test.
- Define the MCP read-path surface (tools + resources + uniform `DuskError`) and the `dusk_inspect` consumer surface for `low_confidence` supports (the P2-T8 reframe).
- Pin all cross-change interface seams as frozen contracts for Phases 3/4/5.

**Non-Goals:**

- Anything pipeline-side: Decomposer, worktrees, short cycle, long cycle, Test Runner, livelock detection, recovery ladder, commit, merge, `dusk_cancel`, pause/resume. These are Phase 3's contract.
- Author 5-stage dialog flow, Stage 4.5 validations, dialog persistence. Phase 4.
- Fresh-Verifier audit, static-analysis doctor, observability sinks, benchmark harness, dogfooding. Phase 5.
- `index_snapshot_id` semantics (no session snapshot exists until Phase 3). The field is optional/unset on Phase-2 traces.
- App-package code (`packages/{api,web,shared,hooks,mobile}`) — untouched.

## Decisions

### D1 — Spawn pipeline is a deterministic three-stage assembler

`spawnSubAgent({role, beadId?, dialogId?, sessionId, input})` runs three stages in order **before** any Task call:

1. **Memory load** — read the named memory scope (`none`/`bead`/`dialog`/`session`) into a typed shape; `none` returns the empty scope.
2. **Skills inject** — read `.claude/skills/dusk/<role>/<skill>.md` for each skill listed in the role frontmatter; concatenate skill bodies into a `skillsBlock`.
3. **System-prompt assembly** — combine `roleBody` + `skillsBlock` + scope-specific memory rendering + `input` into a single assembled prompt string.

The assembled string is then passed to the Claude Code Task tool. **In test/benchmark mode** the assembled string is also recorded verbatim in the emitted trace's `raw_prompt` field (App. A.6); in production mode `raw_prompt` is absent.

**Alternative considered:** fetch role + skills from disk *inside* the Task call. Rejected: it puts assembly inside an opaque boundary, makes the asymmetry and polarity tests untestable (we'd have no observable surface), and double-touches the file system per spawn.

### D2 — `raw_prompt` capture is test/benchmark-gated, by-config, and never logs secrets

The runtime carries a single `spawnMode: "production" | "test" | "benchmark"` flag (sourced from an env hook in `env.ts` consumed via injection; not from `process.env` directly per coding standards). Only `test` and `benchmark` modes emit `raw_prompt`. Production traces omit the field entirely — there is no path where a production trace serializes the assembled prompt. Sensitive content (Anthropic API keys, repository absolute paths) is redacted to a `<redacted:type>` token before serialization, by allowlist of known patterns; the redaction is applied to **every** outgoing trace field for defense in depth.

**Alternative considered:** always-on `raw_prompt`. Rejected: prompts can carry 10–50 kB per spawn, production trace volume becomes unmanageable, and the field's purpose is *observability for tests*, not production audit.

### D3 — Verifier freshness is **behavioral**, not byte-identical

The round-3 board fix routes the convergence diagnosis to the Bead Orchestrator only. The test surface for this is *structural absence*, not byte-identity of the assembled prompt: across spawns within a session, the Verifier payload's *iteration-distinguishing* content (iter counters, diagnosis text, prior verdicts, prior failing-triple sets) must be empty. P2-T1 asserts this against `raw_prompt` via known-identifier checks. The plan explicitly reframes off byte-identity (which trivially breaks on innocuous trace-header differences); P2-T1 + P2-T3 land that reframe.

**Behavioral freshness — the empirical variance across N independent calls on the same input — is Phase 5's audit, not Phase 2's job.** Phase 2 proves the *structural* invariant.

### D4 — Antecedent evaluation lives inside `runtime/verifier`, not a separate package

The §3.3 procedure step 3 is "for `compose: implies` intents, evaluate the antecedent group by deterministic index lookup before any LLM call." Extracting antecedent evaluation to its own package would split the procedure across module boundaries and make the "zero LLM call when antecedent false" property a cross-package invariant — harder to test, harder to maintain. Implementation: a pure submodule `runtime/verifier/antecedent.ts` that takes `(intent, unitUnderEvaluation, indexQuery) → AntecedentResult` and is called from the main procedure. The "no Verifier Task call when false" property is asserted at the procedure level (P2-T6 checks no `SubAgentTrace` of role `verifier` is emitted), not at the antecedent module's boundary.

**Alternative considered:** `packages/runtime/antecedent-evaluator` as a peer package. Rejected per above; would also produce an artificial public interface between two tightly-coupled steps of one procedure.

### D5 — Verifier-double pluggability via injected factory at the spawn boundary

`spawnSubAgent` accepts an optional `verifierFactory?: VerifierFactory` parameter; production mode defaults to the real Verifier. The scripted-verdict double implements the same `VerifierFactory` interface, accepts a `fixtureScript` of verdicts, returns them in order without any Task call, and increments a process-local `spawnCount` for telemetry. The double participates in the **same** `SubAgentTrace` emission path so test assertions on traces work uniformly across real and doubled Verifier runs.

**Alternative considered:** parallel `spawnSubAgentTestDouble` function. Rejected: duplicates the spawn pipeline, risks divergence (e.g., the production path adding a trace field the double omits), and forces tests to choose between two surfaces. The factory-injection seam is the smallest necessary boundary.

### D6 — Bead-memory format is structured YAML frontmatter + Markdown sections; compaction is a pure transform

The bead memory file at `.ia/runtime/beads/<bead-id>/<role>.md` has YAML frontmatter (`bead_id`, `role`, `last_iter`, `last_compacted_at_iter`) followed by named Markdown sections per §9.6.1 (`## Current diagnosis`, `## Approaches tried (impl)`, `## Approaches tried (test-authoring)`, `## Verifier signals (last 3)`, `## Intent set in scope`, `## Files being modified`). Each section parses to a typed shape and re-serializes deterministically — same input always produces the same output bytes.

**Compaction** is a pure transform `compact(memory: BeadMemory): BeadMemory` invoked by the Bead Orchestrator on write-back when `Verifier signals` exceeds three entries. The transform keeps the last three signals verbatim and folds older entries into the appropriate `Approaches tried` channel, preserving `(triple_id, focal_verdict, slot_focus, approach_label)` and dropping verbose rationale. The transform performs **no LLM call** — every test that exercises the memory pipeline asserts no model call occurred during write-back (P2-T2).

**Alternative considered:** LLM-summarized rolling memory. Rejected per the round-3 board: LLM summarization introduces iteration-dependent variance, undermines determinism, and risks fabricating content. Mechanical compaction is sufficient because what the next iteration needs is a structured record of what has been tried, not prose.

### D7 — Polarity inversion at the procedure boundary, not the LLM call

The Verifier's prompt builder always poses the **affirmative** question (`"In this code, does <subject> <predicate> <object> hold?"`) regardless of the triple's `polarity`. The LLM returns `pass | fail` on the affirmative claim. The runtime then performs `focal_verdict = polarity === "negative" ? invert(llmVerdict) : llmVerdict`. The original `polarity` is preserved in the trace's `per_triple[].polarity` field so post-hoc analyzers (Phase 5's audit) can correctly attribute inversions.

This is the only correct boundary: any earlier, the LLM sees negation and the v9 weak-spot reappears; any later, aggregation logic must repeat the inversion check for each `compose` mode.

### D8 — Scoped evidence assembly is bounded and returns a structural error on overflow

For a given `(intent, aspect)`, the Verifier assembles:

- The **focal evidence** — source lines for every focal claimant of `(intent, aspect)`.
- The **support evidence** — source lines + inline NL triple for every support claimant of `(intent, aspect)`.
- The **triple set** — affirmative-framed (with `quantifier`/`scope` annotations).
- The **antecedent decision** if `compose: implies` (a boolean from the index lookup; consequents only if true).

The total assembled evidence is capped at `verifier_evidence_max_lines` (default 200). On overflow, the procedure returns `DuskError { kind: "verifier_evidence_too_large" }` — never silently truncates. The same error is returned when the antecedent's `subject` binds ambiguously (P2-T7b).

### D9 — `support_quality` is a pure aggregation; per-claim `triple_verdict` is LLM-extracted

For each `@intent-support` claim in the aspect's evidence, the Verifier prompt asks a structured sub-question: "Does this NL triple accurately describe the statement at lines X–Y? Answer `matches` | `mismatch` | `vague`." Each claim gets its own `triple_verdict`. The intent-level `support_quality` is then computed by the pure aggregation rule (`any mismatch → low_confidence`; `≥50% vague → low_confidence`; else `ok`). P2-T9 unit-tests the aggregation in isolation; P2-T8 exercises both the LLM extraction and aggregation through the real procedure.

### D10 — MCP resources and paired tools share the underlying query

Each `dusk://*` resource and its paired `dusk_*` tool call the **same** read function in `packages/runtime/{verifier,observability,index}`. The MCP server has two thin transport adapters: one serves results via the MCP resource protocol; one serves them via the MCP tool protocol. Structural equivalence (P2-T13) is guaranteed because the data flows through one query function. Byte-identity is explicitly **not** asserted (the round-4 reframe) — serializers may format whitespace or field order differently, but the parsed objects must contain the same intent ids, fields, and counts.

### D11 — `dusk_inspect` is the documented consumer for `low_confidence` supports

The P2-T8 reframe requires the low-confidence signal to surface at its documented consumer, not just in the verdict. `dusk_inspect` adds a `low_confidence_supports[]` field per intent in its response: `{intent_path, aspect_id, claim: {file, lines, quote}, support_triple, triple_verdict}`. The field is empty when no recent verdict produced low-confidence supports for the intent; populated from the most recent verdict per intent. Phase 5's `/dusk-doctor` will later aggregate these into an erosion-trend report.

### D12 — Statistical thresholds for verdict-correctness tests are pre-registered

Tests that touch the real frontier model (`temperature: 0`) — P2-T5 polarity inversion, P2-T8 verdict split, P2-T10 scoped reading, P2-T12 worked example, P2-T15/T15b/T15c quantifier enforcement, P2-T16 composition, P2-T17 implies prompt structure — run **N=3 independent invocations per assertion** by default, and the test passes when ≥2/3 produce the documented structural outcome. The N and threshold are encoded as test-suite constants, surfaced in test output as `N=3, threshold=2/3`. Tests using the scripted-verdict double (P2-T1..T4 spawn/asymmetry/skills, plus all Phase-3 control-flow tests) run **N=1** because they are deterministic.

**Alternative considered:** N=1 for everything. Rejected: frontier-model behavior at `temperature: 0` is *highly* but not *byte*-deterministic; an explicit-N protocol with pre-registered threshold is honest and reproducible.

## Cross-change interface seams (pinned here; later phases consume them)

- **`SubAgentTrace` field set for Phase 2** — `schema_version: 1`, `trace_id`, `bead_id?`, `role`, `invocation_site`, `model`, `prompt_tokens`, `completion_tokens`, `latency_ms`, `cost_usd`, `input_summary?`, `output_summary?`, `skills_loaded?[]`, `iteration_number?`, `raw_prompt?` (test/benchmark mode only). `index_snapshot_id?` is reserved (set in Phase 3). Phase 5 audit reads `raw_prompt`; Phase 3 short-cycle reads `iteration_number` + `verdict_delta_from_prior` (added in Phase 3).
- **`Verdict` output shape** (App. A.4) — `intent_path`, `decision`, `implies_antecedent_held?`, `per_triple[] { triple_id, focal_verdict, support_quality, polarity, evidence: { focal_claim?, support_claims[] { file, lines, quote, support_triple, triple_verdict }, support_pass_count? }, rationale }`, `aggregate_rationale`. Phase 3 short-cycle consumes this; Phase 5 audit aggregates over it.
- **Bead memory file format** — YAML frontmatter + named Markdown sections per D6; compaction is a pure transform. Phase 3 short-cycle does the writes; this design owns the shape.
- **Verifier-double seam** — `spawnSubAgent({..., verifierFactory?: VerifierFactory})`. Phase 3 control-flow tests inject scripted-verdict factories.
- **`DuskError` envelope** — extended with `verifier_evidence_too_large` (kind 8a in App. A.11) and `intent_path_unresolved`. Phase 3 adds pipeline-specific kinds; this design adds the verification kinds.
- **`dusk_inspect` response shape** — adds `low_confidence_supports[]` per intent. Phase 5's `/dusk-doctor` aggregates this into the erosion-trend report.
- **`dusk.config.yml` shape** — Phase 2 reads `models.default`, `models.overrides`, `verifier_evidence_max_lines`. No additions to the file's outer shape (Phase-1 contract held).

## Risks / Trade-offs

- **[Frontier-model cost in CI]** Verdict-correctness tests use real-frontier calls at N=3. **Mitigation:** the verdict-correctness subset is gated behind a `pnpm test:correctness` task that runs in nightly CI, not on every PR; PR CI runs control-flow tests (scripted-verdict double) + the unit-only aggregation tests + the structural-MCP tests against a doubled Verifier. Cost is bounded, and every property has a determined surface.
- **[`raw_prompt` redaction false negatives]** A novel secret pattern not in the allowlist could leak. **Mitigation:** the redaction allowlist is reviewed before every Phase 5 audit run; the production path emits no `raw_prompt` so the blast radius is test/benchmark only. A redaction-test suite asserts known secret patterns are scrubbed before any trace serializes.
- **[Bead-memory format churn]** Phase 3 writes intensively against this format. **Mitigation:** the format is owned by `packages/runtime/memory` with a typed read/write API; Phase 3 cannot reach inside the format string. The compaction transform is a pure function exercised by Phase 2's P2-T2 over 20 simulated iterations.
- **[Scoped evidence overflow on large intents]** A heavily decorated function with many supports could exceed `verifier_evidence_max_lines`. **Mitigation:** the structural error is the honest answer (per Dusk's "no silent behavior" stance); Phase 5 audit will report the per-intent evidence-size distribution so projects can re-author intents with finer granularity.
- **[MCP resource protocol parity on Claude Code]** Claude Code's MCP resource surface may not be fully exercised by typical clients. **Mitigation:** the paired tools are the universal fallback (per RFC §10.1); P2-T13 asserts structural equivalence so neither surface diverges silently.
- **[Test-mode flag leakage to production]** A misconfigured deployment could leave `spawnMode: "test"`. **Mitigation:** the flag is injected from `env.ts` only; the production server's startup banner logs the mode; `dusk doctor` checks the mode and refuses pipeline operations if `spawnMode !== "production"`.

## Migration Plan

Phase 1 is archived and its specs synced to `openspec/specs/`. Phase 2 lands as a single change with no production-data migration: nothing in `.ia/runtime/` exists yet (no bead has ever run), `dusk.config.yml` already carries the keys this phase reads (Phase-1 contract), and the existing `dusk init`/`validate`/`inspect`/`doctor --check-hook` commands gain Phase-2 siblings (`verify`, `roles`, `skills`) without modifying their own behavior. Rollback is `git revert` of the merge commit — no on-disk state to clean.

## Open Questions

- **Q1 — Frontier-model identifier and per-role overrides surface.** The roadmap commitments table names `claude-sonnet-4-6` as the v1 default. Confirmed via `dusk.config.yml > models.default`; per-role overrides via `models.overrides.<role>: <model-id>`. **Resolution:** lock this in tasks; ship a sane default and one fixture exercising an override.
- **Q2 — Verifier-prompt few-shot location.** Two-shot positive + two-shot negative examples drawn from App. B. Should they live in `dusk-verifier.md`'s body, or in a shared `dusk/verifier/few-shots.md` skill? **Resolution:** in the role-file body — the few-shots are part of the prompt template's two-path structure, not a swappable skill. (If a project wants to *augment* with project-specific few-shots, it adds them via a tier-2 skill in Sprint 9 dogfooding.)
- **Q3 — `dusk_inspect` low-confidence retention window.** How long are low-confidence supports remembered between verdicts? **Resolution:** keep only the most recent verdict per intent in Phase 2; Phase 5's `/dusk-doctor` aggregates across history when it ships.
