## ADDED Requirements

### Requirement: Every non-ignored file is fully covered or the gate hard-blocks

Coverage SHALL be universal: every file not matched by the ignore set (below) SHALL be fully linked to intents — comment-bearing files inline, comment-less files via the per-file sidecar. Coverage SHALL be computed per run as set arithmetic: parse the target, resolve each claim/ignore anchor to a line span, then `uncovered = non-trivial-lines − covered − ignored`, where non-trivial excludes blank and structural-only lines (bare `{ } [ ] ,`). Any non-empty `uncovered` SHALL be a hard gate block — full coverage ALWAYS. The finding SHALL report the **target's** `file:line`, not the sidecar's. A whole-file claim (`@intent-file` / root pointer `""`) is the maximal tile and the floor for unstructured targets. (RFC App. D.28, Ch. 4.5.4; design D4.)

#### Scenario: An uncovered non-trivial line hard-blocks

- **WHEN** a non-ignored target has a non-trivial line owned by no claim and no `@intent-ignore`
- **THEN** the gate blocks with an `uncovered_target_lines` rejection naming the target file and line

#### Scenario: A whole-file claim covers every line

- **WHEN** a sidecar carries a single claim with the root pointer `""` and marker `intent-file`
- **THEN** every line of the target is covered and the coverage check passes

### Requirement: A dusk-level ignore glob set is the only exemption from coverage

`dusk.config.yml` SHALL carry `decoration.ignore: [<globs>]` — the single source of truth for files/directories exempt from decoration coverage — with built-in defaults (`node_modules/**`, `.git/**`, `.ia/runtime/**`, `dist/**`, `build/**`, `coverage/**`, `**/*.lock`, `.env*`) merged with project additions. This set SHALL be consumed identically by the gate, the coverage scanner, and `dusk doctor`, and SHALL replace the hardcoded `SKIP_DIRS` in the static-analysis doctor. A glob-ignored file SHALL NOT be gated, coverage-checked, or flagged. This project-level glob ignore is distinct from the per-claim `@intent-ignore` marker (a documented region within a covered file, carrying because/reason). (RFC App. D.28; design D5.)

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
