## ADDED Requirements

### Requirement: The gate validates per-file sidecars and enforces coverage on comment-less files

The PreToolUse gate (and the headless `gateWorktreeEdits`) SHALL recognize `<stem>.intent` per-file sidecars (already gated via the `.intent` extension) and enforce them with new mechanical, zero-model checks: the sidecar parses as valid JSON of the expected shape (`malformed_sidecar`); its `target` field equals its stem and the target exists (`sidecar_target_missing`); every claim/ignore anchor resolves against the live target (`unresolved_anchor`); no two claims resolve to overlapping spans (`overlapping_anchors`); and — in the post-hoc pair-state pass — every non-trivial line of a non-ignored target is covered (`uncovered_target_lines`). Per-claim intent paths and aspect ids reuse the existing `unresolved_intent_path`/`unresolved_aspect_id` checks; ignore entries reuse the existing `@intent-ignore` because/reason vocabulary. The gate SHALL consult the `decoration.ignore` glob set and skip ignored files. (RFC App. D.28; design D4/D5/D7.)

#### Scenario: A new rejection kind fires on an uncovered comment-less line

- **WHEN** the post-hoc worktree gate finds a non-ignored target with an uncovered non-trivial line
- **THEN** it blocks with `uncovered_target_lines` reporting the target file and line

#### Scenario: A dangling sidecar anchor is rejected

- **WHEN** a sidecar claim's JSON Pointer does not resolve against the live target
- **THEN** the gate blocks with `unresolved_anchor` naming the sidecar and pointer

#### Scenario: An ignored file is not gated for coverage

- **WHEN** a write touches a file matched by a `decoration.ignore` glob
- **THEN** the gate applies no sidecar/coverage check to it
