## ADDED Requirements

### Requirement: The audit reasons on two orthogonal axes — coverage and provenance — never conflating them

Since the `universal-decoration-coverage` prerequisite (RFC App. D.28) landed, "what must be decoration-covered" and "what must carry commit trailers" are **two different axes**, and the Phase-6 audit tooling SHALL keep them separate (design D4):

- **Coverage axis (governed by `decoration.ignore`, enforced by the runtime).** Every file not matched by `decoration.ignore` is decoration-covered — comment-bearing source inline, comment-less files (`package.json`, `tsconfig.json`, configs) via their colocated `<file>.intent` sidecar. The only coverage-exempt files are the `decoration.ignore` globs. Configs/manifests are therefore **coverage-required** (they carry sidecars and count toward the 100%-coverage bar, P6-T8); they are NOT coverage-exempt. P6-T8 consumes this (static-analysis clean over the covered tree, sidecars included).
- **Provenance axis (governed by the Phase-6 trailer auditor).** Which *commits* must carry the full v9 trailer set. **Trailer-required** (pipeline-produced): all runtime application source AND all test bodies under the pyramid suffixes (`unit-tests`/`integration-tests`/`e2e-tests`). **Trailer-exempt scaffold** (may be `dusk init`-/hand-authored, an explicit allowlist): the `dusk init` output; the stack-config files (`package.json`/`tsconfig`/`vitest.config`/Drizzle config); generated migrations; the Vitest infra provisioning (`globalSetup` + the e2e app-boot helper). Anything else under the source tree is trailer-required.
- **The axes cross:** a file can be **trailer-exempt yet coverage-required** (e.g. `package.json` is scaffold for provenance but carries a `package.json.intent` sidecar for coverage). The auditor SHALL rule each file on **both** axes and never assume "scaffold ⇒ uncovered." (Plan Phase 6 Scope; design D4; **P6-T1**, **P6-T8**.)

#### Scenario: A non-allowlisted source file is trailer-required

- **WHEN** the auditor encounters a `.ts` file under the application source tree not on the trailer-exempt allowlist
- **THEN** it is classified as trailer-required and its commit MUST carry the full v9 trailer set

#### Scenario: A config manifest is trailer-exempt yet coverage-required

- **WHEN** the auditor evaluates `package.json` (on the trailer-exempt allowlist) that carries a `package.json.intent` sidecar
- **THEN** its commit is not required to carry trailers (provenance axis)
- **AND** it still counts as decoration-covered via its sidecar (coverage axis), not coverage-exempt

#### Scenario: Only `decoration.ignore` globs are coverage-exempt

- **WHEN** the auditor (or `dusk doctor`) evaluates the coverage axis
- **THEN** only files matching `decoration.ignore` (e.g. `node_modules/**`, `.env*`, `**/*.lock`) are coverage-exempt
- **AND** every other file — including configs and the infra harness — is decoration-covered (inline or sidecar)

### Requirement: The trailer auditor proves zero hand-written application code from the git record alone

A trailer-audit script SHALL walk the POC repo's full history as a **zero-model pure pass over `git log`**. For every commit touching *required* application source, it SHALL assert the commit carries the full v9 trailer set (actual keys, fixed App. A.7 order, from `packages/runtime/commit/src/render.ts`: `Intent`, `Test-Intent`, `Bead-id`, `Verdict-id`, `Test-Verdict-id`, `Trace-id`, `Verifier-model`, plus the gated-path conditionals `Partial`/`Deferred-Intent`/`Verifier-bypassed-test-intent` when present) OR that the commit is a merge of such commits. It SHALL also assert the human-input whitelist (authoring-dialog responses, `dusk_implement` requests, `dusk_resolve_livelock`/recovery resolutions, commit review/merge approval) covers every recorded human action. The auditor SHALL be verified against the **real `git log` of an actual pipeline run** in the POC repo — never a synthesized commit shape — and SHALL include a deliberately-malformed-commit negative case proving it actually rejects. (Plan Phase 6 Scope; RFC §1, §6.7, App. A.7; design D5; **P6-T1**.)

#### Scenario: Every application-source commit carries full trailers

- **WHEN** the auditor runs over the POC's full history
- **THEN** every commit touching required application source carries the full v9 trailer set or is a merge of such commits
- **AND** the audit reports zero hand-written application commits

#### Scenario: The auditor rejects a malformed commit

- **WHEN** the auditor is run against a commit touching required application source that is missing a required trailer
- **THEN** it fails the audit and names the offending commit and the missing trailer

#### Scenario: The auditor is exercised against real pipeline output

- **WHEN** the auditor's own verification runs
- **THEN** it is driven against the real `git log` produced by an actual `dusk implement` run, not a hand-built commit fixture

### Requirement: Intent provenance is asserted against durable records, not the destroyed dialog directory

Because `dusk_author_finalize` destroys `.ia/runtime/dialogs/<id>/` (the Phase-4 contract), provenance SHALL be asserted against durable records. The transcript/provenance checker SHALL, for every intent under the POC's `.ia/intents/`, assert a correlating author-role event in the observability trace stream (`traces.jsonl`, `role: "author"`) plus the finalize record (`intents_created`) naming it; and SHALL assert the tree contains ≥1 `polarity: negative` triple, ≥1 closed-vocabulary `compose: implies` intent, and pyramid children at unit + integration + e2e layers. The checker is a zero-model pure pass. (Plan Phase 6 Scope; RFC §5; design D6; **P6-T2**.)

#### Scenario: An intent without a correlating author trace fails provenance

- **WHEN** the checker finds an intent with no corresponding `role: "author"` trace event or no finalize `intents_created` record
- **THEN** it fails and names the orphaned intent

### Requirement: Born-decorated code shows zero erosion under static analysis

Running `dusk doctor --static-analysis` (conservative) over the finished POC SHALL produce zero unresolved `S ⊄ D` findings (any finding is either pipeline-fixed or carries a documented disposition); running `--strict-unknowns` SHALL produce zero `undecorated_callee` findings in application code. This is the strongest available evidence for the decorate-at-authorship design — total decoration is produced AND maintained on born-decorated code. (Plan Phase 6 Scope; RFC §4.1, §8.9; design D5/D8; **P6-T8**.)

#### Scenario: Static analysis is clean in both modes

- **WHEN** `dusk doctor --static-analysis` and then `--strict-unknowns` run over the finished POC
- **THEN** the conservative mode reports zero unresolved `S ⊄ D` findings
- **AND** the strict mode reports zero `undecorated_callee` findings in application code
