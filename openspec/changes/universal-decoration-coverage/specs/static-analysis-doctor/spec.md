## ADDED Requirements

### Requirement: `dusk doctor --static-analysis` reports comment-less coverage and consumes the ignore SSoT

The static-analysis doctor SHALL extend its off-write-path analysis to comment-less files: for every non-ignored target with a per-file sidecar, it SHALL re-resolve each anchor against the live file and report uncovered non-trivial lines (`uncovered_target_lines`) and dangling anchors (`unresolved_anchor`) as findings. It SHALL consult the `decoration.ignore` glob set from `dusk.config.yml` as the **single** ignore source — replacing the hardcoded `SKIP_DIRS` — so the gate, the coverage scanner, and doctor never disagree on what is exempt. Comment-less coverage findings SHALL be reported on the mechanical/structural channel (never blended into semantic adherence). (RFC App. D.28; design D5/D6.)

#### Scenario: Doctor flags an uncovered comment-less line off the write path

- **WHEN** `dusk doctor --static-analysis` runs over a project whose non-ignored `package.json` has an uncovered line
- **THEN** it reports an `uncovered_target_lines` finding at the target's `file:line`

#### Scenario: The hardcoded skip set is replaced by the config ignore globs

- **WHEN** the doctor walks the project
- **THEN** it skips exactly the files matched by `decoration.ignore` (not a separate hardcoded `SKIP_DIRS`)
