# Tasks — universal-decoration-coverage

> Determinism: every task here is a **zero-model** mechanical pass (parsing, anchor resolution, set arithmetic, glob matching) with colocated Vitest unit coverage. No real-model calls.

## 1. Keystone — one shared `.intent`-aware scanner (lands first)

- [ ] 1.1 Add a shared `scanDecorations(rootDir, opts)` to `@dusk/core-decoration` that walks the project, dispatches by file class (comment-bearing → `parseDecorations`; basename `.intent` → `parseDotIntent`; `<stem>.intent` → the new sidecar parser, §3), honors the `decoration.ignore` globs (§4), and returns merged `DecorationRecord[]`. Acceptance: `decoration-parser` scenario "A directory `.intent` record reaches the derived index (fails today)". Test plan: a colocated test that builds an index over a fixture with a directory `.intent` claim and asserts it appears in `buildDerivedIndex` output + `reverse(file)` — **written to fail against current code first**, then pass.
- [ ] 1.2 Replace the three `.ts`-only walkers with the shared scanner: `packages/delivery/mcp-server/src/context.ts` `scanDecorations`, `packages/cli/src/project.ts` `scanDecorations`, `packages/cli/src/doctorStaticAnalysis.ts` `collectSources`. Acceptance: all three load `.intent`/sidecar records; existing index/Verifier/doctor tests stay green. Test plan: extend each package's tests to assert a `.intent` record is visible through that entry point.

## 2. Schema deltas (additive)

- [ ] 2.1 Extend `DecorationRecord` (`packages/core/decoration/src/types.ts`): add `anchor: string | null`, `region` to `DecorationScope`, `verify: "structural" | "semantic"`. Update all record-constructing sites (`parseDecorations`, `parseDotIntent`) to set defaults (`anchor: null`, `verify: "semantic"`). Acceptance: `comment-less-decoration` scenario "Existing inline records are unaffected". Test plan: existing decoration tests pass unchanged; a new assertion that inline records default `anchor:null`/`verify:semantic`.
- [ ] 2.2 Add the sidecar body schema to `@dusk/core-schema` (Zod, source of truth): `{ schema_version: 1, target, claims:[{ anchor, marker, intent_path, aspect_ids? }], ignore:[{ anchor, because, reason }] }`. Add `decoration.ignore: string[]` to the `dusk.config.yml` schema with built-in defaults. Acceptance: schema parses canonical fixtures; rejects a malformed sidecar. Test plan: colocated unit tests per schema.

## 3. The sidecar parser + JSON-Pointer resolver

- [ ] 3.1 Add `parseFileIntentSidecar(sidecarSource, targetSource)` to `@dusk/core-decoration`: parse the sidecar JSON; parse the target with a **location-aware** JSON/JSONC parser; resolve each claim/ignore `anchor` (RFC 6901 JSON Pointer; `""` = whole document) to a `[startLine, endLine]` span; emit `DecorationRecord[]` with `verify: "structural"`, `anchor` set, and `line` = the **derived** span start. A pointer that does not resolve → a structured `unresolved_anchor` error (never a silent skip). Acceptance: `comment-less-decoration` scenarios "A pointer resolves to a current line span after the file is reformatted" + "A dangling pointer is a hard finding". Test plan: colocated tests — resolve a pointer; reformat the target and re-resolve (span moves, no stored number); delete the key → `unresolved_anchor`.

## 4. `decoration.ignore` SSoT

- [ ] 4.1 Add a glob matcher + `loadIgnoreGlobs(config)` (defaults merged with project additions) as the single ignore source. Replace the hardcoded `SKIP_DIRS` in `packages/cli/src/doctorStaticAnalysis.ts` with it; consume it in the shared scanner (§1) and the gate (§5). Acceptance: `decoration-coverage` scenarios "An ignored directory requires no coverage" + "one SSoT across the gate, scanner, and doctor". Test plan: unit tests for glob matching + a test asserting all three consumers honor an added glob.

## 5. Gate — sidecar validity + coverage enforcement + rejection kinds

- [ ] 5.1 Add rejection kinds to `REJECTION_KINDS` (`packages/delivery/pre-tool-use/src/rejections.ts`): `malformed_sidecar`, `sidecar_target_missing`, `unresolved_anchor`, `overlapping_anchors`, `uncovered_target_lines`. Acceptance: kinds present + typed. Test plan: type/enum test.
- [ ] 5.2 Per-write single-file sidecar validity in the gate (`checks.ts`): sidecar parses; `target` === stem; intent paths/aspects resolve (reuse existing checks); ignore vocabulary valid. Does NOT run cross-file tiling. Acceptance: `pretooluse-gate` scenario "A dangling sidecar anchor is rejected"; `decoration-coverage` scenario "A legitimate two-step edit is not false-blocked". Test plan: gate unit tests for each rejection + the two-step non-block.
- [ ] 5.3 Post-hoc coverage tiling in `gateWorktreeEdits` (`packages/cli/src/implement.ts`): over the settled worktree, for each non-ignored target compute `uncovered = non-trivial-lines − covered − ignored`; non-empty → `uncovered_target_lines` (report the target's `file:line`); overlapping spans → `overlapping_anchors`. Acceptance: `decoration-coverage` scenario "An uncovered non-trivial line hard-blocks" + `pretooluse-gate` "A new rejection kind fires on an uncovered comment-less line". Test plan: unit tests over fixture worktrees (full cover passes; a gap blocks; whole-file `""` covers all; ignored file skipped).

## 6. Doctor — off-path coverage

- [ ] 6.1 Extend `dusk doctor --static-analysis` to report comment-less coverage (uncovered/dangling) over non-ignored targets, on the mechanical channel; consume the `decoration.ignore` SSoT. Acceptance: `static-analysis-doctor` scenarios. Test plan: doctor unit tests (uncovered flagged; ignored skipped; clean project → no findings).

## 7. Verifier — structural skip

- [ ] 7.1 Exclude `verify: "structural"` records from the semantic Verifier prompt (`packages/runtime/verifier`); their satisfaction is mechanical (anchor resolves + Stage-2 build/test), reported separately. Acceptance: `verifier-procedure` scenario "A config sidecar claim is not sent to the semantic Verifier". Test plan: a test asserting a structural record never enters the assembled semantic prompt.

## 8. Integration + landing

- [ ] 8.1 End-to-end fixture: a project with a comment-bearing file (inline), a `package.json` + `package.json.intent` (sidecar, full coverage), an ignored `node_modules` and `.env`. Assert: index sees all decoration sources; gate passes when covered, blocks on an introduced gap; doctor clean; structural records skipped by the semantic Verifier. Acceptance: the proposal's Verifiability/acceptance bullet end-to-end. Test plan: one integration test composing §1–§7.
- [ ] 8.2 `pnpm build` + `pnpm test` + `pnpm typecheck` green across affected packages; `openspec validate universal-decoration-coverage --strict` passes; archive.
