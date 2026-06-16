# Handoff — Build `universal-decoration-coverage` (then we return to Phase 6)

> Paste this whole file as the opening prompt for a **fresh orchestration session**. Its job: implement the already-designed, already-spec'd `universal-decoration-coverage` capability in the **dusk monorepo**, get all unit/integration/e2e tests green, then stop. After it lands, the operator returns to the **other** session to restart the Phase-6 greenfield POC from scratch. Everything here is designed and committed; your job is **execution against a validated OpenSpec change**, not redesign.

---

## 0. Mission in one paragraph

Dusk's `v9` thesis is **total decoration**: every line of code links to the intents it serves, so any code is always traceable to intents. But decoration is implemented only as **inline `// @intent` comments**, which **comment-less formats cannot carry** (strict JSON — `package.json` — cannot hold a comment). So total decoration is *not* total: files exist that cannot be linked to intents, and nothing enforces their coverage. A 3-round architecture board designed the closure (RFC **App. D.28** + **Ch. 4.5.4**), and it is fully captured as a **validated OpenSpec change**: `openspec/changes/universal-decoration-coverage/` (proposal + design + 6 capability specs + tasks; `openspec validate universal-decoration-coverage --strict` passes). **Implement that change, keystone-first, with zero-model mechanical code + unit tests, then an integration test, then archive.** Do not change inline decoration for comment-bearing code (that model is correct and intentional). When done and green, hand back.

---

## 1. Context — what Dusk is, where we are

Dusk is a constraint-satisfaction system for spec-driven AI development: humans author **intents** (atomic, slash-pathed, with structured triples) via the `dusk_author` dialog; a 9-step `dusk_implement` pipeline turns intents into adherent, **fully-decorated** code; a multi-agent Verifier judges adherence. Repo: the **dusk monorepo** (you work here), TS strict ESM, pnpm + Turborepo, Vitest, `@dusk/*` packages under `packages/`.

This capability was surfaced while building the **Phase-6 greenfield POC** (a notifications API built entirely through dusk with zero hand-written application code). The POC needs its `package.json`/config produced through dusk and linked to intents — impossible today. So this capability is a **prerequisite** for a fully-decoration-covered POC and is being built **first**, in its own session (this one). The POC restart happens **after** you finish.

**Sequencing (now canonical across the RFC set).** `universal-decoration-coverage` is the **first v1.x change**; the Phase-6 Greenfield POC is the **second** and depends on it. The order is `v1 lands → universal-decoration-coverage → Phase-6 POC restarts`. This is stated identically in `docs/rfcs/001-mvp-rfc/`: the implementation plan's **"Post-v1 prerequisite — Universal Decoration Coverage"** section (just before Phase 6), the roadmap's **Sprint 11 "Two v1.x changes, in order"** note, and the proposal's **D.23 + D.28** (with D.11 ↔ D.28 cross-referenced for why a sidecar is allowed here but not for comment-bearing code). Two axes the POC keeps separate but you need not — for your build, *every non-ignored file must be covered*, full stop; the POC's distinct "trailer-exempt vs coverage-required" provenance bookkeeping is downstream and not your concern.

**Delivery discipline (NON-NEGOTIABLE):** spec-driven via OpenSpec. The change already exists and is validated — drive it with the OpenSpec apply/verify/archive workflow. Conventional commits. ALWAYS run `pnpm build`, `pnpm test`, `pnpm typecheck` after changes. Functional-first, Zod = source of truth (derive types via `z.infer`), named exports, `type` over `interface`, files < 500 lines, colocated `*.test.ts`. Never save working files to repo root.

---

## 2. What is ALREADY done and committed (do NOT redo)

All on `dusk` `main`, working tree clean. The change is **fully designed and board-converged** — three post-integration arch-board rounds (APPROVE / 3× APPROVE-WITH-CHANGES, then convergence declared) hardened it and the two open questions are **resolved (R1, R2 — see §3/§9)**. Your job is execution, not redesign. Key commits:

| Commit | What |
|---|---|
| `fc67b19` | **doc(rfc): add this build handoff** |
| `436e207` | **doc(rfc): weave udc (D.28) across the RFC set** — plan/roadmap/proposal + sequencing |
| `99bd821` | **spec(udc): board-converged design + resolved Q1/Q2** — the index-boundary partition (4 consumers), the all-three-skip-sets SSoT, the explicit JSON/JSONC predicate, red-first keystone, App. A.8 +5-kinds note, R1 `jsonc-parser`, R2 whole-file-default. **This is the state of the change you implement.** |
| `3100171` | **doc(udc): scaffold universal-decoration-coverage OpenSpec change** — the validated spec you implement |
| `a7bd56d` | **doc(rfc): D.28** universal decoration coverage flowed into the RFC (App. D.28 + Ch. 4.5.4 + roadmap) |
| `3be3520` | refactor(P6): generalize foundation-gap → a general `prerequisite` tension class (no flow coupling) |
| `3106a68` | doc(P6): spec deltas for external-repo base-ref fixes (D.27) |
| `cf3e321` | feat(P6): Author Stage-2 foundation-gap detection (D.25) |
| `f62b7ae` | doc(rfc): Phase-6 arch-board decisions D.24–D.27 into the RFC |
| `c2a6253` | fix(P6): engineer wall-clock overrun salvages partial draft, never discards (D.26) |
| `fbdfcaa` | fix(P6): resolve base ref for standalone repos; require worktree baseRef (D.27) |
| `bd6aa19` | fix(P6): external-repo gate resolution + `dusk implement --help` flags (D.27) |
| `cf13a72` | feat(P6): add `PocReport` schema to `@dusk/core-schema` |
| `3950bf2` | doc(P6): scaffold phase-6-greenfield-poc OpenSpec change |

**Decisions already ratified and recorded in `docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md` Appendix D — read them; they are your design constraints:**
- **D.24** greenfield foundation IS authored intents, not an orchestration phase (no synthesized foundation bead/spawn/Block).
- **D.25** the Author surfaces an unmet dependency as a general `prerequisite` tension (Stage-2), no bootstrap state in the flow.
- **D.26** a wall-clock overrun on the Engineer is a *continue* (salvage partial worktree), not a discard-and-die; **no per-spawn turn budget**.
- **D.27** dusk operates correctly against an external standalone repo with no remote (gate-path + base-ref resolution; worktree requires resolved SHA, fails loud).
- **D.28** ← **THIS CAPABILITY** (full text in the proposal's Appendix D and summarized below).

You will not touch D.24–D.27 behavior; they are context for why the POC exists. Your scope is **D.28 only**.

---

## 3. The capability to build (D.28) — design

### 3.1 The gap and the ROOT framing
Inline `// @intent` only reaches comment-bearing code. The right mental model (board consensus): **ONE decoration model (`DecorationRecord[]`) with multiple parsers** — inline, the directory `.intent` file, and a NEW per-file sidecar — all normalizing to the same record type → one derived index. This is NOT "two systems"; the second modality is a third *parser*.

### 3.2 🔑 THE KEYSTONE BUG (fix FIRST — load-bearing)
The existing directory `.intent` sidecar is parsed **only by the gate** (`packages/delivery/pre-tool-use/src/checks.ts`, the `file.endsWith(".intent")` branch → `runDotIntentChecks`). The three **index-building walkers are `.ts`-only and never read `.intent`**, so `.intent` records **never reach `buildDerivedIndex`** → invisible to the Verifier, reverse-index, and `dusk doctor`. The three walkers:
- `packages/delivery/mcp-server/src/context.ts` — `scanDecorations` (`SOURCE_EXT` = `.ts/.tsx/.js/.jsx/.mts/.cts`) **+ its own `SKIP_DIRS`**; feeds `loadProjectContext` → Verifier + reverse-index.
- `packages/cli/src/project.ts` — `scanDecorations` (`/\.(ts|tsx)$/`) **+ its own `SKIP_DIRS`**; doctor/inspect.
- `packages/cli/src/doctorStaticAnalysis.ts` — `collectSources` (`SOURCE_EXT` = `.ts/.tsx`) **+ its own `SKIP_DIRS`**.

**All THREE carry divergent hardcoded skip sets** (board M2 — not just `doctorStaticAnalysis.ts`; members differ, e.g. `.turbo`/`.next` in two, `.claude` in one). When you collapse the three walkers into ONE shared `.intent`-aware scanner in `@dusk/core-decoration`, **subsume all three skip sets into the single `decoration.ignore` SSoT** (§3.6) — leaving any one behind re-creates the fragmentation the keystone exists to kill. Land the scanner FIRST, committing the keystone test **red** — it must fail against current code before the scanner lands (that red is the evidence the bug is real; do not state "fails today" as fact, demonstrate it), then green: a directory `.intent` claim must appear in `buildDerivedIndex` output. A gorgeous new sidecar parser bolted onto only the gate would reproduce this exact bug one layer deeper.

### 3.3 The per-file sidecar `<filename.ext>.intent`
- e.g. `package.json.intent` colocated beside `package.json`. **Reuses the already-gated `.intent` extension** — `isGatedFile` (`packages/delivery/pre-tool-use/src/rejections.ts`) already returns true for `*.intent`, so the sidecar is auto-gated on **both** the live PreToolUse hook AND the headless `gateWorktreeEdits` with **zero `isGatedFile` change**.
- **Dispatch by basename:** a file named exactly `.intent` → directory-scope parser (existing `parseDotIntent`); a basename with a stem ending `.intent` → per-file sidecar whose `target` is the stem.
- **Body (JSON):** `{ schema_version: 1, target, claims: [{ anchor, marker, intent_path, aspect_ids? }], ignore: [{ anchor, because, reason }] }`. Markers reuse the existing `DecorationMarker` set; ignore reuses the existing `@intent-ignore` because/reason vocabulary.

### 3.4 Structural anchors STORED; line view DERIVED (the drift-killer)
- The stored source-of-truth is a **JSON Pointer** (RFC 6901): `/scripts/build`; `""` = whole document.
- **Never store line numbers/ranges/content-hashes/source-map structures.** Line spans are **resolved every run** via **`jsonc-parser`** (board R1 — Microsoft/VS Code's; zero runtime deps; native JSONC; `parseTree` + `findNodeAtLocation` for pointer nav; build a `lineStarts` index for offset→line; `parseTree` `errors[]` → `malformed_sidecar`; `findNodeAtLocation` `undefined` → `unresolved_anchor`. NOT `yaml` — it silently mis-parses JSONC — and NOT `JSON.parse` — it discards positions). Pointer → AST node → `[startLine, endLine]`. A pointer that no longer resolves → a **hard `unresolved_anchor` finding**, never a silent skip. This is a **trade, not strict dominance** (board S5): immune to *positional* drift (reformatting/reordering) where inline's line model is not, traded for sensitivity to *key* drift (a renamed key dangles, surfaced as that hard finding). The trade landing on the safe side is why a sidecar is acceptable here even though **D.11** rejected sidecars for comment-*bearing* code (where inline is possible and mandatory — that verdict stands).
- Rejected explicitly (operator originally proposed "mimic source-map shapes"; the board redirected): a source map exists to recover positions after a *lossy* transform where the original is gone — here the target is on disk and re-parseable, so storing line data only re-imports drift. You get the operator's actual goal (computable line coverage) by *deriving* the spans, not storing them.

### 3.5 Universal full coverage — computed and HARD-BLOCKED
- Every file **not** matched by the ignore set must be fully covered (inline if comment-bearing, sidecar if comment-less).
- Per-run set arithmetic: parse target → resolve each claim/ignore anchor to a span → `uncovered = non-trivial-lines − covered − ignored`. **"Non-trivial" uses an explicit JSON/JSONC predicate (design D4), NOT the TS `CLOSING_ONLY_RE` (which mis-handles `"build": "tsc",`):** a line is trivial iff, trimmed, it is empty, OR only structural tokens (`{ } [ ] , :`) + whitespace, OR a JSONC comment line (`//…`, `/* */`, `*`-led). A line bearing a key or scalar is non-trivial and must be covered.
- **Any non-empty `uncovered` HARD-BLOCKS at the gate** — full coverage ALWAYS (operator directive). The finding reports the **target's** `file:line`, not the sidecar's.
- Whole-file (`@intent-file` / root pointer `""`) is the maximal tile and the floor for unstructured targets (containment survives). **It is also the DEFAULT (board R2):** emit one whole-file claim per file; use per-key `scope:"region"` claims ONLY when a file genuinely serves multiple distinct intents (a whole-file claim there is a false attribution — the trigger is honesty, not ergonomics; per-key is invisible to the deduped reverse-index and feeds no semantic consumer, so it's never required for coverage).

### 3.6 The `decoration.ignore` glob SSoT — the ONLY exemption
- `dusk.config.yml` gains `decoration.ignore: [<globs>]` with **built-in defaults** (`node_modules/**`, `.git/**`, `.ia/runtime/**`, `dist/**`, `build/**`, `coverage/**`, `**/*.lock`, `.env*`) merged with project additions.
- **One SSoT** consumed identically by the gate, the coverage scanner, and `dusk doctor`. It **REPLACES all three hardcoded `SKIP_DIRS`** (`context.ts`, `project.ts`, `doctorStaticAnalysis.ts` — board M2), not only the doctor's. Defaults span three named categories so the silent exemptions are explicit: **deps** (`node_modules/**`, `.git/**`), **generated** (`.ia/runtime/**`, `dist/**`, `build/**`, `coverage/**`, `**/*.lock`), **secrets** (`.env*`). The generated-file line follows a principle: checked-in + meaningfully authored (configs, migrations) → covered via sidecar; pure build output (`dist/`, lockfiles) → ignored.
- **Two tiers, never conflated:** (1) the **glob ignore** exempts whole files/dirs out of scope (deps, secrets, generated output); (2) the per-claim **`@intent-ignore`** marker exempts a documented region *within* a covered file (because/reason). Glob-ignored files are not gated, not coverage-checked, not flagged.

### 3.7 Verification — mechanical/structural, NEVER the semantic Verifier
- Comment-less/config records are tagged `verify: "structural"` and **excluded from the semantic path at the index boundary** (board M1) — NOT merely from the prompt. The keystone routes structural records into `buildDerivedIndex`, where `focalSupport`/`aspectRollup`/`isSatisfied` (`packages/core/index/src/derivedIndex.ts`) key on `marker` alone; a sidecar's `intent`/`intent-file` marker is focal, so a prompt-only filter would let a structural claim silently flip a semantic aspect to **satisfied**. Partition `verify:"structural"` out of **all four** semantic consumers — `focalSupport`, `aspectRollup`, `isSatisfied`, AND `packages/runtime/verifier/src/antecedent.ts` (the `compose: implies` antecedent gate — round-2 M1-extension; it reads raw `records` with its own `FOCAL_MARKERS` + `scope:"file"`/`"directory"` predicates, so a structural `intent-file`/`scope:"file"` claim could make a semantic antecedent hold/invert). Cleanest: `buildDerivedIndex` exposes a **semantic-only** record set those four consume; **the public `records` field STAYS THE FULL set** — structural records must remain visible to `reverse()`/`dusk_inspect`/doctor or you re-hide them and undo the keystone. Assert both: non-contamination of *satisfaction* (incl. a `compose: implies` antecedent), AND a structural record still visible via `reverse()` after the partition. `doctorStaticAnalysis.ts` reads raw `records` intentionally (benign — config lacks the declaration/body-line shape it matches). Their "satisfaction" is the mechanical coverage pass (gate green / doctor clean / Stage-2), surfaced via those reports — **not** a separate per-record verdict object (board M3; don't build one). A manifest has no architectural triple to judge; mechanical verification confirms presence + anchoring, not the correctness of the intent↔region binding (an accepted, recorded trade — board S2). **Never blended into semantic adherence.**

### 3.8 Scope (the over-engineering traps to REFUSE)
- **JSON-only sidecars** (JSON + JSONC). Any other comment-less format gets whole-file `@intent-file` coverage until a real second structured format demands more.
- **NO** general any-format region map / per-format parser registry; **NO** source-map/VLQ machinery; **NO** content-hash re-anchoring; **NO** schema-migration framework (one literal `schema_version: 1`).

---

## 4. The build plan (authoritative: `openspec/changes/universal-decoration-coverage/tasks.md`)

Drive it with `/openspec-apply-change universal-decoration-coverage`. Ordered, dependency-first, all zero-model mechanical code + colocated Vitest:

1. **§1 KEYSTONE** — shared `.intent`-aware scanner in `@dusk/core-decoration`; **write the failing test first** (a directory `.intent` record reaches `buildDerivedIndex`); then replace the 3 walkers (`context.ts`, `project.ts`, `doctorStaticAnalysis.ts`). Keep all existing tests green.
2. **§2 Schema deltas (additive)** — extend `DecorationRecord` (`packages/core/decoration/src/types.ts`): `anchor: string | null`, `region` scope member, `verify: "structural" | "semantic"` (defaults `anchor:null`/`verify:semantic` so existing records/parsers unchanged). Add the sidecar body Zod schema + `decoration.ignore` config to `@dusk/core-schema`.
3. **§3 Sidecar parser** — `parseFileIntentSidecar(sidecarSource, targetSource)`: parse sidecar JSON; parse target with **`jsonc-parser`** (R1; `parseTree` + `findNodeAtLocation`, `lineStarts` for offset→line); resolve each anchor (JSON Pointer; `""` = whole doc) → line span; emit `DecorationRecord[]` with `verify:"structural"`, `anchor` set, `scope` (`region` per-key / `file` whole-file), `line` = derived span start; dangling pointer → structured `unresolved_anchor`; malformed → `malformed_sidecar` (from `parseTree` errors).
4. **§4 `decoration.ignore` SSoT** — glob matcher + `loadIgnoreGlobs(config)`; replace `SKIP_DIRS`; consume in the shared scanner + gate.
5. **§5 Gate** — add rejection kinds (`malformed_sidecar`, `sidecar_target_missing`, `unresolved_anchor`, `overlapping_anchors`, `uncovered_target_lines`) to `REJECTION_KINDS`; per-write single-file sidecar validity in `checks.ts` (parses; `target`===stem; intent paths/aspects/ignore vocab resolve — reuse existing checks); **post-hoc coverage tiling in `gateWorktreeEdits` (`packages/cli/src/implement.ts`)** over the settled worktree (pair-state — avoids false-blocking two-step target+sidecar writes).
6. **§6 Doctor** — `dusk doctor --static-analysis` reports comment-less uncovered/dangling on the mechanical channel; consume the ignore SSoT.
7. **§7 Verifier** — exclude `verify:"structural"` records from the semantic path **at the index boundary** (all four consumers: `focalSupport`/`aspectRollup`/`isSatisfied` + `antecedent.ts`), keeping public `records` FULL; satisfaction is mechanical. NOT a prompt-only filter (that's the M1 bug).
8. **§8 Integration + landing** — one end-to-end fixture (inline file + `package.json`+sidecar with full coverage + ignored `node_modules`/`.env`); assert index sees all sources, gate passes when covered / blocks on an introduced gap, doctor clean, structural records skipped by the Verifier. Then `pnpm build`/`test`/`typecheck` green; `openspec validate --strict`; **archive** (`/openspec-archive-change universal-decoration-coverage`).

---

## 5. Key code references (verify before leaning on them)

- **Decoration:** `packages/core/decoration/src/{types.ts (DecorationMarker/Scope/Record, IgnoreClause), parseDecorations.ts (inline), parseDotIntent.ts (directory `.intent`; hardcodes scope:"directory"), index.ts (barrel)}`.
- **Index:** `packages/core/index/src/derivedIndex.ts` (`buildDerivedIndex`; `FOCAL_MARKERS` includes `intent-file`); `staticAnalysis.ts` (TS-only S⊆D call-graph — config has no call graph; leave it TS-scoped).
- **Gate:** `packages/delivery/pre-tool-use/src/rejections.ts` (`isGatedFile` — the SSoT for both gate paths; `REJECTION_KINDS`); `checks.ts` (`runChecks` dispatch, `runDotIntentChecks`, `IGNORE_PREDICATES`, `CLOSING_ONLY_RE`/`isBlank`, `unresolved_intent_path`/`unresolved_aspect_id`); `runGate.ts`.
- **The 3 walkers (keystone):** `packages/delivery/mcp-server/src/context.ts` `scanDecorations`; `packages/cli/src/project.ts` `scanDecorations`; `packages/cli/src/doctorStaticAnalysis.ts` `collectSources` + `SKIP_DIRS`.
- **Headless gate:** `packages/cli/src/implement.ts` `gateWorktreeEdits` (post-hoc pair-state coverage lands here); `ENGINEER_FILE_INSTRUCTION` (teach: comment-less file → write a `<file>.intent` sidecar with structural pointers, never line numbers, rewrite whole).
- **Verifier:** `packages/runtime/verifier/src/{procedure.ts (verifyIntent), evidence.ts (assembleEvidence; firstCodeLine strips `//`), prompt.ts (buildVerifierUserPrompt)}`.
- **Config schema:** `@dusk/core-schema` (`dusk.config.yml` loader/schema) — add `decoration.ignore`.

---

## 6. Constraints / non-goals (do not violate)

- **Keystone first**, with a failing test — or the whole thing is decorative.
- **One model, `DecorationRecord[]`** — the sidecar is a parser, not a parallel index.
- **Structural anchor stored; line view derived.** No stored line numbers/ranges/hashes/source-maps.
- **Full coverage always; hard-block** on any uncovered non-trivial line in a non-ignored file. The ONLY exemptions are `decoration.ignore` globs (whole files/dirs) and per-claim `@intent-ignore` (regions, with reasons).
- **Config = mechanical/structural verification**, never the semantic Verifier; never blended into semantic adherence.
- **JSON-only** sidecars; whole-file fallback otherwise. No general region map, no per-format registry, no VLQ, no content-hash.
- **Do not change inline decoration / D.11** for comment-bearing code — inline stays mandatory there; sidecars are forbidden on commentable files.
- Honor `isGatedFile` as the single gate SSoT (no parallel file-type lists); the `decoration.ignore` set as the single ignore SSoT.

---

## 7. Definition of done

- `openspec/changes/universal-decoration-coverage/tasks.md` fully checked; `openspec validate universal-decoration-coverage --strict` passes.
- Keystone test (a `.intent`/sidecar record reaches `buildDerivedIndex` and is visible to Verifier/reverse-index/doctor) — green (was red).
- Sidecar: pointer resolves to correct derived line span; survives target reformat; dangling pointer → hard `unresolved_anchor`.
- Coverage: uncovered non-trivial line in a non-ignored file hard-blocks (`uncovered_target_lines`); whole-file `""` covers all; ignored file/dir skipped by gate+scanner+doctor.
- Structural records are excluded from the semantic path at the index boundary (all four consumers) — non-contamination of *satisfaction* (incl. a `compose: implies` antecedent) is asserted, AND a structural record stays visible via `reverse()` after the partition (keystone preserved). Not a prompt-only filter.
- `pnpm build`, `pnpm test`, `pnpm typecheck` green across affected packages; **unit + integration tests pass** (this capability is mechanical, so the "e2e" the operator referenced = the §8 integration test composing §1–§7 end-to-end; there is no live-infra/model e2e for this capability).
- Change **archived** (synced to `openspec/specs/`).
- Friction/defects surfaced during the build handled per the D11 policy (scoped fix + regression test + living-spec delta if behavior was mis-specified).

---

## 8. The return path (what happens after you finish)

Once `universal-decoration-coverage` is archived and green, the operator returns to the **other** session to **restart the Phase-6 greenfield POC from scratch**. For your awareness only (do NOT do this work):
- The POC repo is **adjacent** to dusk: `…/Repositories/dusk-notifications-poc` (currently reset to empty, fresh `git init` + `dusk init`, no application code).
- The Phase-6 OpenSpec change is `openspec/changes/phase-6-greenfield-poc/` (validated; not yet implemented).
- With your capability landed, the POC's `package.json`/config become decoration-covered through the sidecar, so the POC can hit **100% coverage** (the operator's "full coverage ALWAYS" bar) — which is exactly why this capability is a prerequisite.
- The Author already detects the greenfield foundation as a `prerequisite` tension and steers foundation-first authoring (D.25, validated against the real model).

**Your deliverable is the dusk-repo capability only.** Do not touch the POC repo or the Phase-6 change.

---

## 9. Source-of-truth references

- `docs/rfcs/001-mvp-rfc/intent-architecture-proposal.md` — **App. D.28** (full decision), **Ch. 4.5.4** (universal coverage), **Ch. 4.1/4.5** (total decoration mandate), **D.11** (why sidecars were rejected for comment-bearing code — respect this reasoning).
- `openspec/changes/universal-decoration-coverage/` — **proposal.md, design.md (decisions D1–D9 + resolved R1/R2 + a "Review round" ledger; archive-time: collapse that ledger when syncing to specs), specs/{comment-less-decoration, decoration-coverage, decoration-parser, pretooluse-gate, static-analysis-doctor, verifier-procedure}/spec.md, tasks.md** — THE build contract.
- `CLAUDE.md` (repo root) — conventions.
- The architecture board's full reasoning is distilled into the proposal/design/D.28. The original design board (Lead Architect, Lead Backend Engineer, Lead AI Engineer, Martin Fowler) converged over 3 rounds; **three further post-integration re-audit rounds** then verified it and resolved R1 (`jsonc-parser`) + R2 (whole-file default), declaring convergence — recorded in design.md's "Review round" section.

**Build for right. Keystone first. Total decoration, genuinely total. Then hand back.**
