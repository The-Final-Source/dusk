## Context

v9's total-decoration claim (RFC §4.1, §4.5) is realized only by inline `// @intent` comments, which comment-less formats (strict JSON: `package.json`) cannot carry — so total decoration is not total, and the greenfield POC cannot link its config to intents. A decoration board (3 rounds) designed the closure (RFC App. D.28, Ch. 4.5.4). This change implements it as a standalone v1.x capability and a prerequisite for the POC. Every decision below is the board's converged position; this document pins the seams.

## Goals / Non-Goals

**Goals:**
- Every file not on the ignore set is fully linked to intents — inline (comment-bearing) or via a per-file sidecar (comment-less) — with **computable, enforced line coverage**.
- One decoration model (`DecorationRecord[]`), drift-proof anchoring, mechanical verification for config, a single ignore SSoT.

**Non-Goals:**
- No general any-format region map (JSON-only sidecars; whole-file fallback otherwise).
- No source-map/VLQ machinery, no stored line numbers, no content-hash re-anchoring.
- No change to inline decoration for comment-bearing code (D.11 stands: inline mandatory where possible; sidecars forbidden on commentable files).

## Decisions

### D1 — One model, three parsers; fix the keystone first
Inline (`parseDecorations`), the directory `.intent` (`parseDotIntent`), and the new per-file sidecar all normalize to `DecorationRecord[]` → one `buildDerivedIndex`. It is not a second system. **Keystone:** today the directory `.intent` is parsed *only* by the gate (`packages/delivery/pre-tool-use/src/checks.ts`); the three index walkers (`packages/delivery/mcp-server/src/context.ts` `scanDecorations`, `packages/cli/src/project.ts` `scanDecorations`, `packages/cli/src/doctorStaticAnalysis.ts` `collectSources`) are `.ts`-only and never read it, so `.intent` records never reach the index/Verifier/doctor. Collapse the three walkers into **one shared scanner** in `@dusk/core-decoration` that dispatches by file class and emits the merged `DecorationRecord[]`. Land this FIRST with a test that fails today (a `.intent` record must appear in `buildDerivedIndex` output). *Alternative considered:* add the sidecar parser only to the gate — rejected; it reproduces the exact invisibility bug one layer deeper.

### D2 — Per-file sidecar `<filename.ext>.intent`; basename dispatch; reuse the gated extension
`package.json.intent` sits beside `package.json`. Reusing the `.intent` extension means `isGatedFile` (`packages/delivery/pre-tool-use/src/rejections.ts`) already returns true → auto-gated on the live hook AND the headless `gateWorktreeEdits`, zero `isGatedFile` change. Dispatch by basename: `=== ".intent"` → directory-scope parser (unchanged); ends `.intent` with a non-empty stem → per-file sidecar whose `target` is the stem. *Alternatives:* `<file>.intent.json` (rejected — ends `.json` → silently un-gated, the keystone bug class) and extending the directory `.intent` to address siblings (rejected — a shared file the memory-less Engineer must read-modify-merge each cycle risks clobbering peer claims; per-file is a clean overwrite it owns).

### D3 — Structural anchor stored; line view derived (the drift-killer)
The sidecar stores a **JSON Pointer** (RFC 6901) per claim (`/scripts/build`; `""` = whole document) — the source of truth. **Line ranges are never stored.** They are resolved every run by a location-aware JSON parser (pointer → AST node → `[startLine, endLine]`). A pointer survives reformatting/reordering; a pointer that no longer resolves is a **hard `unresolved_anchor` finding**, never a silent skip — strictly stronger anti-drift than inline's line model, and why a sidecar is acceptable here though D.11 rejects it for comment-bearing code (where inline is possible). *Rejected:* storing line ranges + content hash ("mimic source-map shapes") — re-imports the drift D.11 killed; a source map exists to recover positions after a lossy transform, which does not apply (the target is on disk, re-parseable).

### D4 — Universal full-coverage, computed and hard-blocked
Every file not glob-ignored must be fully covered. Per run: parse the target → resolve every claim/ignore anchor to a span → `covered = ⋃ intent-spans`, `ignored = ⋃ ignore-spans`, `uncovered = non-trivial-lines − covered − ignored`. "Non-trivial" excludes blank and structural-only lines (bare `{ } [ ] ,`) — reuse the spirit of the gate's existing `CLOSING_ONLY_RE`/`isBlank`. **Any `uncovered ≠ ∅` hard-blocks** (full coverage ALWAYS — the operator's directive); the finding reports the **target's** `file:line`, not the sidecar's. Whole-file (`@intent-file` / root pointer `""`) is the maximal tile and the only honest unit for unstructured targets (containment survives as the floor).

### D5 — `decoration.ignore` glob SSoT; two-tier ignore
`dusk.config.yml` gains `decoration.ignore: [<globs>]` with built-in defaults (`node_modules/**`, `.git/**`, `.ia/runtime/**`, `dist/**`, `build/**`, `coverage/**`, `**/*.lock`, `.env*`) merged with project additions — the **single** set consumed by the gate, the coverage scanner, and doctor (it **replaces the hardcoded `SKIP_DIRS`** in `doctorStaticAnalysis.ts`). Two tiers, never conflated: (1) the **glob ignore** exempts whole files/dirs that are out of scope (deps, secrets, generated output); (2) the per-claim **`@intent-ignore`** marker exempts a documented region *within* a covered file (with because/reason). Glob-ignored files are not gated, not coverage-checked, not flagged.

### D6 — Config verified mechanically/structurally; never the semantic Verifier
A manifest carries no architectural triple to judge. Sidecar/comment-less records are tagged so the semantic Verifier **skips** them (`packages/runtime/verifier`); their verification is mechanical — anchor resolves + coverage tiles + the existing Stage-2 build/test — reported on the mechanical channel only, never blended into semantic adherence (honors the mechanical-vs-semantic separation).

### D7 — Enforcement split: per-write structural validity; post-hoc pair-state coverage
The two files (target + sidecar) may be written in separate tool calls, so the **per-write live hook** runs only single-file structural validity (sidecar parses; intent paths/aspects/ignore vocab resolve) — it does NOT run cross-file tiling (the other file's post-edit content isn't reliably co-present). The **full coverage tiling runs in the post-hoc `gateWorktreeEdits`** (`packages/cli/src/implement.ts`) over the settled worktree, where both files are present and write-order is irrelevant. Doctor re-runs coverage off the write path. This avoids false-blocking legitimate two-step edits while still guaranteeing coverage on the converged state.

### D8 — `DecorationRecord` schema delta (additive)
Add `anchor: string | null` (the JSON Pointer; `null` for inline/directory records), a `region` scope member, and a `verify: "structural" | "semantic"` discriminator (default `semantic`, sidecar records `structural`). All additive with defaults so every existing record + parser is unchanged. The sidecar parser emits records whose `line` is the derived span start and whose `anchor` carries the pointer.

### D9 — Scope JSON-only; refuse the over-engineering traps
JSON (and JSONC) sidecars only; any other comment-less format gets whole-file `@intent-file` coverage until a real second structured format demands more. Explicitly refused (board-named): a general any-format region map / per-format parser registry; source-map/VLQ machinery; content-hash re-anchoring; a schema-migration framework (one literal `schema_version: 1`).

## Risks / Trade-offs

- **[Keystone regression]** Adding the sidecar parser to only the gate reproduces the invisibility bug → land the shared scanner first, with a test that fails today and asserts a sidecar record reaches `buildDerivedIndex`.
- **[Location-aware JSON parser becomes a per-format zoo]** → ship JSON/JSONC only; whole-file fallback for everything else.
- **[Two-file write ordering false-blocks]** → coverage tiling only in the post-hoc pair-state gate, not per-write (D7).
- **[Coverage flooding on deps/generated files]** → the `decoration.ignore` SSoT with conservative defaults; whole-file `@intent-file` is a one-line cover for the rest.
- **[Dangling pointer treated softly]** → it MUST be a hard finding; soft-handling reopens the drift hole that justified storing structural anchors.

## Migration Plan

Additive within the dusk monorepo. Sequence: (1) keystone shared scanner + failing test; (2) `DecorationRecord` schema delta; (3) sidecar parser + JSON-Pointer resolver; (4) `decoration.ignore` config + SSoT plumbing (replace `SKIP_DIRS`); (5) gate coverage checks + rejection kinds (per-write validity + post-hoc tiling); (6) doctor coverage report; (7) Verifier structural-skip. Existing inline decoration and the directory `.intent` are unchanged in behavior (the keystone only makes the latter *visible*). Then the greenfield POC restarts from scratch with full coverage available.

## Open Questions

- **JSONC location parser choice** (e.g. `jsonc-parser` AST vs `json-source-map`) — an implementation detail resolved at build time; both yield per-node line spans. Whichever is chosen must agree with the project's formatter on line attribution.
- **`@intent-file` default ergonomics** — whether a single whole-file claim is the encouraged default for simple manifests (one line of sidecar) vs per-key regions only where a file serves multiple intents. Lean: whole-file default, regions by exception (keeps coverage cheap, avoids per-key ceremony).
