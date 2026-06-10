## ADDED Requirements

### Requirement: Spawn pipeline assembles role + memory + skills before the Task call

The system SHALL expose `spawnSubAgent({role, beadId?, dialogId?, sessionId, input}) → SubAgentResult` in `packages/runtime/orchestrator/spawn` which, **before** calling Claude Code's Task tool, deterministically (1) loads the named memory scope, (2) reads + concatenates the `skills:` listed in the role's frontmatter from `.claude/skills/dusk/<role>/<skill>.md`, and (3) assembles a single system-prompt string from `roleBody + skillsBlock + memoryRendering + input`. Only then is the Task tool invoked with `subagent_type: dusk-<role>` and the assembled prompt. (RFC §9.9; design D1; Plan P2-T1.)

#### Scenario: Spawning the Engineer materializes its declared skills and bead memory

- **WHEN** `spawnSubAgent({role: "engineer", beadId, sessionId, input})` is called for an Engineer whose frontmatter declares three `dusk/engineer/*` skills and whose bead memory file exists
- **THEN** the assembled system prompt contains the role body, all three skill bodies, and the bead memory rendering
- **AND** the Task tool is called with `subagent_type: "dusk-engineer"` exactly once
- **AND** the emitted `SubAgentTrace.skills_loaded[]` lists exactly those three skills

#### Scenario: Spawning a Verifier materializes none memory and no diagnosis

- **WHEN** `spawnSubAgent({role: "verifier", beadId, sessionId, input})` is called against a bead whose memory file contains a populated `## Current diagnosis` section
- **THEN** the assembled system prompt for the Verifier contains zero substrings from that diagnosis (the prompt's memory rendering is the empty block for `memory: none`)

### Requirement: `dusk_role_version` is enforced at spawn time

The runtime SHALL refuse to spawn a role whose role file declares a `dusk_role_version` outside the supported range, returning a typed error before any Task tool call is issued. (RFC §9.5; Plan P2-T19.)

#### Scenario: Out-of-range version is refused

- **WHEN** a role file declares `dusk_role_version: 999` and `spawnSubAgent` targets that role
- **THEN** the spawn returns an unsupported-version error
- **AND** no Task tool call is made (no Task trace is emitted for that spawn attempt)

### Requirement: Every spawn emits a SubAgentTrace with the Phase-2 field set

Every successful or failed spawn SHALL emit one `SubAgentTrace` event to `.ia/observability/traces.jsonl` carrying `schema_version: 1`, a unique `trace_id`, the `role`, the `invocation_site`, the resolved `model`, token counts, latency, and the `skills_loaded[]` enumeration. `iteration_number?` is set when the spawn occurs inside a short-cycle iteration; `index_snapshot_id?` is reserved (set in Phase 3). (RFC App. A.6; design D1; Plan P2-T4.)

#### Scenario: A successful Engineer spawn writes a complete trace

- **WHEN** an Engineer spawn completes against a real (or scripted-double) target
- **THEN** exactly one `SubAgentTrace` line appears in `traces.jsonl` with `role: "engineer"`, the assembled `skills_loaded[]` list, and the token/latency/cost fields populated

### Requirement: `raw_prompt` is captured in test/benchmark mode only, with redaction

In `spawnMode ∈ {"test", "benchmark"}` the spawn pipeline SHALL record the verbatim assembled system prompt as `SubAgentTrace.raw_prompt`. In `spawnMode: "production"` the field SHALL be absent. Before serialization, an allowlist-driven redaction SHALL replace recognized secret-shaped tokens (API keys, absolute repo paths) with `<redacted:type>` markers across **every** outgoing trace field. (RFC App. A.6; design D2; Plan P2-T1/T3/T5/T17.)

#### Scenario: Test-mode trace exposes raw_prompt; production-mode trace omits it

- **WHEN** the same spawn runs under `spawnMode: "test"` then `spawnMode: "production"`
- **THEN** the test-mode trace's `raw_prompt` equals the assembled system prompt verbatim (modulo redaction)
- **AND** the production-mode trace contains no `raw_prompt` field

#### Scenario: Known-shape secrets are redacted before serialization

- **WHEN** an assembled prompt contains an Anthropic-style API key
- **THEN** the persisted `raw_prompt` contains `<redacted:anthropic_api_key>` and not the key

### Requirement: Tool and skill scoping are advisory in v1; the PreToolUse gate is the real safety boundary

The spawn pipeline SHALL honor the role frontmatter's `tools:` list as configuration passed to the Task tool and SHALL inject only the skills named in the role's `skills:` list, but the runtime SHALL NOT hard-sandbox tool calls — the PreToolUse gate (delivered in Phase 1) is the real safety boundary for writes. Skill loads are observable via `SubAgentTrace.skills_loaded[]` for post-hoc audit. (RFC §9.4, §9.7; Plan P2-T4.)

#### Scenario: A skill outside the role's frontmatter is not injected

- **WHEN** a role frontmatter lists `skills: [dusk/engineer/decoration-completeness]` but the directory contains additional skill files
- **THEN** the assembled prompt contains the declared skill body and not the others
- **AND** `SubAgentTrace.skills_loaded[]` enumerates only the declared skill

### Requirement: Nine role files exist with v9 frontmatter and complete bodies

The change SHALL ship nine role files under `.claude/agents/dusk-{root,bead,decomposer,scout,engineer,verifier,test-runner,author,conflict-resolver}.md`, each with v9 frontmatter (`dusk_role_version: 2`, `memory`, advisory `tools`, `skills`, `model`) and complete role-body content per RFC §9.5. The `dusk-verifier.md` role file SHALL include the complete prompt template: two-path execution structure for `compose: implies` (antecedents resolved deterministically; only consequents presented), an explicit affirmative-framing contract (no "invert if negated" branch), and 2 positive + 2 negative few-shots drawn from RFC App. B. (RFC §9.1, §9.5, App. A.9; Plan P2 scope.)

#### Scenario: Verifier role file ships the complete two-path template

- **WHEN** `.claude/agents/dusk-verifier.md` is read
- **THEN** its frontmatter declares `dusk_role_version: 2`, `memory: none`, the tier-1 verifier skills, and a `model:`
- **AND** its body contains a section describing the deterministic-antecedent path (no LLM call) and the consequent-only path
- **AND** its body includes two positive and two negative few-shot examples drawn from RFC App. B
