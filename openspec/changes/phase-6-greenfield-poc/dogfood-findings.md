# Dogfood findings — Veylin run (greenfield author → implement)

Source: live dogfood of the full Phase-4/Phase-6 flow on the `veylin` testbed
(authored a 34-intent `exec-assist` corpus, then implemented the
`ingestion/normalized-event-model` bead end-to-end).

Ground truth on the implemented bead: **21/21 Vitest tests pass, strict `tsc`
clean** — the Engineer/Verifier output is correct. The bugs below are in the
*pipeline/reporting*, not the generated code.

## Fixed during the run
- **#1 Gate input-contract** — `pre-tool-use/src/runGate.ts:23` read `input.args`,
  but Claude Code sends `tool_name`/`tool_input`. Fixed via boundary adapter.
- **#2 Stage-3 proposal not returned** — `runtime-author/src/runtime.ts:205,211,217`
  returned the bare question, dropping `practiceProposal`. Fixed.
- **#3 Author transient fragility** — 120s CLI timeout (`verifier/src/modelClient.ts:137`)
  + `maxTurns:8` too tight for multi-subtree drafting. Fixed (raised timeout/turns + retry).

## Open

### #11 Test-Runner reports un-run tests as "executed" (HIGH — verification integrity)
- **Symptom:** `dusk_implement` returned `test_intents_executed: [unit, integration]`,
  beads `done`, zero warnings — but the target repo had **no `package.json`/Vitest**,
  so `pnpm vitest run` could not have run.
- **Repro:** in a repo with no `package.json`, `pnpm vitest run x.test.ts` →
  `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` (non-zero exit). `execFileSync` throws.
- **Root cause:** `runtime/test-runner/src/vitest.ts:18-19` (`defaultRunner` =
  `execFileSync("pnpm", ["vitest","run",...])`) throws on missing manifest; the
  failure is swallowed upstream of `run.ts:73` and the pipeline still reports the
  test-intents as executed.
- **Fix:** surface a `pnpm vitest` non-zero exit / spawn error as a bead failure
  (or an explicit `warnings[]` entry); never report a test-intent `executed`
  unless the Vitest JSON reporter was actually parsed. Add a test for the
  "no manifest / vitest absent" path.

### #4 Pyramid test-children generated for only the first intent (HIGH)
- `runtime-author/src/transition.ts:67-68` `implDraft()` is `.find(...)` (singular);
  pyramid-pick (`:209-213`) + `pyramidPending()` (`:75`) operate on one impl.
  Multi-intent dialogs → only the first intent gets children.
- **Fix:** iterate all eligible impl drafts; `pyramidPending` true while any unpicked.

### #5 `finalize` doesn't refresh `ctx.intents` (HIGH — stale until restart)
- Reads use in-memory `ctx.intents` (`mcp-server/src/queries.ts:166`), loaded once at
  startup (`context.ts:87,104`). `runtime-author/src/finalize.ts` writes files but never
  updates `ctx`. New intents invisible to list/get/inspect/implement until restart.
- **Fix:** hydrate `ctx.intents` on finalize (or read filesystem-fresh).

### #7 `_patch` for existing-intent edits is schema-invalid (MEDIUM)
- Committing the Stage-2 gray-boundary "patch both sides" resolution failed:
  `unrecognized_keys: ['_patch']`. No valid `DraftIntent` representation for a
  description/metadata patch to an existing intent (`in_place_edit` is triple-only).
- **Fix:** first-class draft repr for description patches, or stop Stage 2 proposing
  a resolution finalize can't execute.

### #8 Stage-5 emits false "committed / Dialog complete" messages (MEDIUM)
- `commit`/`(b)` responses claimed files written + "Dialog complete" while nothing
  was written and the dialog stayed open; real write only via `dusk_author_finalize`
  after a `confirm` returning `{finalize_ready:true}`.
- **Fix:** Stage-5 prose must reflect real state; only claim committed post-finalize.

### #9 Stage-1 option (b) drafts an invalid empty `compose:all` parent (MEDIUM)
- "parent + leaf per context" drafts a triple-less parent; `toIntentRaw` defaults
  `compose:"all"` (`validateDraft.ts:42`); schema then requires ≥1 triple → `schema_invalid`.
  Real corpus uses bare directories for path segments (no parent intent.yaml).
- **Fix:** emit no file for container nodes (directory only), allow a `namespace`
  compose, or require a real umbrella triple.

### #10 Stage-4 revision persists additions but not removals (HIGH — livelock)
- "drop intent X" is acknowledged ("dropped, commit-ready") but not applied to
  `intents_drafted`; next `confirm` re-fails on X → livelock. Adding a triple to X
  *did* persist (escape hatch).
- **Fix:** apply removals to draft state; test "revise → remove X → X absent at finalize."

### #12 Implement path nested-agent turn/timeout budget not raised (HIGH — blocks non-trivial beads)
- **Symptom:** `dusk_implement` on `ingestion/adapter-contract` failed with
  `two transport-classified deaths` — each leg `error_max_turns`, `num_turns:4`,
  `stop_reason:tool_use`. First (trivial) bead succeeded; first non-trivial bead cut off.
- **Root cause:** the #3 fix raised maxTurns/timeout only on the **author** model client
  (`cli/src/author.ts:42` → `maxTurns:8, timeoutMs:300_000`). The **implement** path was
  not updated: `cli/src/implement.ts:282` `claudeCodeModelClient({ model })` (no overrides,
  default 120s), and the Engineer headless agent (`implement.ts:330 runHeadlessAgent`) spawns
  a nested `claude` at the **default ~4-turn cap**.
- **Fix:** mirror the author fix on the implement path — raise the nested Engineer's
  maxTurns (≥8) and timeout for `runHeadlessAgent` / the implement model client.

### #14 Nested Engineer agents inherit (and break on) the host project's Claude Code hooks (HIGH)
- **Symptom:** the same failure also reported `claude CLI exited 1: SessionEnd hook
  [hook-handler.cjs session-end] failed` — the nested Engineer `claude` ran the **veylin
  testbed's own claude-flow hooks** and the SessionEnd hook crashed, exiting non-zero →
  transport death, discarding the agent's work.
- **Root cause:** `runHeadlessAgent` spawns `claude` with `cwd` = the target repo, so the
  nested agent loads the target's `.claude/settings.json` hooks (UserPromptSubmit routing,
  SessionStart/End, etc.). Any failing/host-specific hook can kill or pollute the Engineer.
- **Fix:** isolate nested agents from host project hooks — run them with a dedicated/empty
  settings (e.g. an explicit settings path or a flag disabling project settings), so Dusk's
  Engineer is hermetic regardless of what hooks the target repo defines.

### #13 Implement failure leaks worktrees + bead branches (MEDIUM)
- On a failed `dusk_implement`, the per-bead git worktrees under `.ia/runtime/worktrees/`
  and `dusk/bd_*` branches are left behind (had to `git worktree remove --force` + `branch -D`
  manually). Successful runs clean up; the failure path does not.
- **Fix:** clean up worktrees/branches in the implement error/abort path.

### #C1 `stage` field lags actual stage (COSMETIC)
- Responses reported `"stage":1` through Stages 1–2 (and dialog 1 jumped 1→3). The
  reported number doesn't track the real stage.

### #E1 No first-class foundational/stack intents (ENHANCEMENT)
- `dusk_implement` takes implementation language as untracked free-text; Stage 1 puts
  stack decisions "out of scope." Worked around by hand-authoring a `platform/` subtree.
  Consider prompting for stack-level intents in Stage 1.
