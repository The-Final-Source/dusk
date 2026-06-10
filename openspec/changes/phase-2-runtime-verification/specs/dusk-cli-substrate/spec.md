## MODIFIED Requirements

### Requirement: The `dusk` CLI exposes the read-path commands that mirror the MCP read surface

The `dusk` CLI SHALL gain four new commands — `dusk verify`, `dusk inspect`, `dusk roles`, `dusk skills` — alongside the Phase-1 commands (`init`, `validate`, `inspect` for raw decoration listing, `doctor --check-hook`). The new commands SHALL be thin wrappers over the §mcp-read-surface tools / runtime queries — `dusk verify` calls the Verifier procedure read-only; `dusk inspect` issues the same query as the MCP `dusk_inspect` (and supersedes/extends the Phase-1 inspect surface to include hierarchical satisfaction, low-confidence supports, and test-intents); `dusk roles` and `dusk skills` introspect the installed `.claude/agents/dusk-*.md` role files and their declared skills. Every new command SHALL support `--help`. (RFC §10.1, §10.2; Phase-1 cli substrate extended.)

#### Scenario: `dusk verify` runs the Verifier procedure read-only

- **WHEN** `dusk verify <path>` is invoked against the App. B fixture
- **THEN** the command prints the per-triple verdicts in a human-readable form
- **AND** the working tree is unchanged and no commit is produced

#### Scenario: `dusk inspect` reports hierarchical satisfaction and low-confidence supports

- **WHEN** `dusk inspect notifications/send` is invoked after a low-confidence verdict has been produced for that intent
- **THEN** the output reports the intent's own-triple satisfaction, the test-pyramid children satisfaction (unsatisfied if test code is absent), and the low-confidence supports

#### Scenario: `dusk roles` lists the nine installed role files with their declared scopes

- **WHEN** `dusk roles` is invoked
- **THEN** the output enumerates `dusk-{root,bead,decomposer,scout,engineer,verifier,test-runner,author,conflict-resolver}` with each role's declared `memory`, `model`, and skill count

#### Scenario: `dusk skills` introspects the installed role-bound skills

- **WHEN** `dusk skills` is invoked
- **THEN** the output enumerates skills grouped by role, matching the layout under `.claude/skills/dusk/<role>/`

#### Scenario: Every new command supports --help

- **WHEN** `dusk verify --help`, `dusk inspect --help`, `dusk roles --help`, `dusk skills --help` are invoked
- **THEN** each prints a usage description, a flag list, and at least one example invocation
