# decoration-coverage Specification

## Purpose
TBD - created by archiving change universal-decoration-coverage. Update Purpose after archive.
## Requirements
### Requirement: Every non-ignored file is fully covered or the gate hard-blocks

Coverage SHALL be universal: every file not matched by the ignore set (below) SHALL be fully linked to intents — comment-bearing files inline, comment-less files via the per-file sidecar. Coverage SHALL be computed per run as set arithmetic: parse the target, resolve each claim/ignore anchor to a line span, then `uncovered = non-trivial-lines − covered − ignored`. **"Non-trivial" SHALL be defined by an explicit JSON/JSONC predicate, not by reusing the TypeScript `CLOSING_ONLY_RE`/`isBlank`** (which would mis-handle JSON, where content lives on lines like `"build": "tsc",`). The predicate SHALL be evaluated against the **location-aware tokenizer's line classification** (comment vs string vs structural), not a raw regex over physical lines, so multi-line string values and lines sharing a value with a block-comment open are attributed by token rather than mis-scored. On that view, a line is **trivial** iff, after trimming, it is (a) empty, (b) consists solely of structural tokens (`{` `}` `[` `]` `,` `:`) and whitespace, OR (c) is a JSONC comment line (`//…`, a `/* … */` line, or a `*`-led continuation) — a comment carries no authored config value and cannot be JSON-Pointer-anchored, so demanding its coverage would make a commented JSONC target permanently un-coverable. A line bearing a key or scalar value is **non-trivial** and must be covered. Any non-empty `uncovered` SHALL be a hard gate block — full coverage ALWAYS. The finding SHALL report the **target's** `file:line`, not the sidecar's. A whole-file claim (`@intent-file` / root pointer `""`) is the maximal tile and the floor for unstructured targets. **A whole-file claim SHALL be the default**; per-key `scope:"region"` claims SHALL be used only when a single file genuinely serves **multiple distinct intents** — because a whole-file claim on a multi-intent file is a false attribution (the per-key trigger is an honesty requirement, not ergonomics; per-key granularity is invisible to the deduped reverse-index and feeds no semantic consumer, so it is never required for coverage). (RFC App. D.28, Ch. 4.5.4; design D4/R2.)

#### Scenario: An uncovered non-trivial line hard-blocks

- **WHEN** a non-ignored target has a non-trivial line owned by no claim and no `@intent-ignore`
- **THEN** the gate blocks with an `uncovered_target_lines` rejection naming the target file and line

#### Scenario: A whole-file claim covers every line

- **WHEN** a sidecar carries a single claim with the root pointer `""` and marker `intent-file`
- **THEN** every line of the target is covered and the coverage check passes

#### Scenario: Whole-file is the default; per-key regions only for a multi-intent file

- **WHEN** a comment-less file serves a single intent set
- **THEN** a single whole-file claim (root pointer `""`, marker `intent-file`, `scope:"file"`) is the expected/default decoration and fully covers it
- **AND WHEN** a single file genuinely serves two or more distinct intents (different regions → different intents)
- **THEN** per-key `scope:"region"` claims partition it so each region names the intent it serves (a whole-file claim there would be a false attribution)

#### Scenario: The non-trivial line set for a real manifest is computed correctly

- **WHEN** the coverage scanner computes the non-trivial line set for a real `package.json` fixture
- **THEN** lines bearing a key or scalar (e.g. `"build": "tsc",`) are counted non-trivial
- **AND** blank lines, lines consisting solely of structural tokens (`{`, `}`, `[`, `]`, `,`, `:`), and JSONC comment lines (`//…`, `/* … */`) are excluded
- **AND** the computed set matches the fixture's pinned expected set for both a `package.json` and a JSONC-with-comments fixture (proving the JSON/JSONC predicate, not the TS `CLOSING_ONLY_RE`)

### Requirement: A dusk-level ignore glob set is the only exemption from coverage

`dusk.config.yml` SHALL carry `decoration.ignore: [<globs>]` — the single source of truth for files/directories exempt from decoration coverage — with built-in defaults (`node_modules/**`, `.git/**`, `.ia/runtime/**`, `dist/**`, `build/**`, `coverage/**`, `**/*.lock`, `.env*`) merged with project additions. This set SHALL be consumed identically by the gate, the coverage scanner, and `dusk doctor`, and SHALL replace **all three** hardcoded skip sets that exist today (`packages/delivery/mcp-server/src/context.ts`, `packages/cli/src/project.ts`, and `packages/cli/src/doctorStaticAnalysis.ts`) — not only the doctor's — so no walker retains a private skip list. A glob-ignored file SHALL NOT be gated, coverage-checked, or flagged. This project-level glob ignore is distinct from the per-claim `@intent-ignore` marker (a documented region within a covered file, carrying because/reason). (RFC App. D.28; design D5.)

#### Scenario: An ignored directory requires no coverage

- **WHEN** a file under `node_modules/` (or any `decoration.ignore` glob) is encountered
- **THEN** it is not gated, not coverage-checked, and not reported by doctor

#### Scenario: The ignore set is one SSoT across the gate, scanner, and doctor

- **WHEN** a project adds a glob to `decoration.ignore`
- **THEN** the gate, the coverage scanner, and `dusk doctor` all honor it without any separate per-tool list

### Requirement: Coverage tiling runs as a post-hoc pair-state check, not per single write

Because a target and its sidecar may be written in separate tool calls, the per-write live hook SHALL run only single-file structural validity (the sidecar parses; its intent paths/aspects/ignore vocabulary resolve), and the full cross-file coverage tiling SHALL run in the post-hoc `gateWorktreeEdits` pass over the settled worktree where both files are present. Doctor SHALL re-run coverage off the write path. (Design D7.)

#### Scenario: A legitimate two-step edit is not false-blocked

- **WHEN** the engineer writes the target in one tool call and its sidecar in another
- **THEN** the per-write hook does not block on transient single-file incompleteness
- **AND** the post-hoc worktree gate enforces full coverage on the converged pair

