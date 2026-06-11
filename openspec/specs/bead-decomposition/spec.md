# bead-decomposition Specification

## Purpose
TBD - created by archiving change phase-3-implementation-pipeline. Update Purpose after archive.
## Requirements
### Requirement: The Decomposer walks typed `relates_to` to assemble the active intent set

`packages/runtime/decomposer` SHALL implement Step 1 of the 9-step pipeline. Given a request and the session snapshot, it SHALL identify directly-touched intents and walk the typed `relates_to` graph per RFC §6.2: `implies`→auto-add the target to the active set + edge to the implied; `conflicts`→**no DAG issued** (`decomposer_bead_conflict`, hard refusal); `supersedes`→exclude the superseded target; `parent`/path→scope+edge (descendant→ancestor); `sibling`→context-only, **no auto-expand into scope**. Test-pyramid children of touched implementation intents SHALL be auto-added to the active set. (RFC §2.1, §6.2; design D2; **P3-T2**.)

#### Scenario: `implies` auto-adds the target to the active set

- **WHEN** a request touches intent X where X has `relates_to: [{kind: implies, target: Y}]`
- **THEN** intent Y enters the active set and a bead is issued for it with an edge from X's bead to Y's bead

#### Scenario: `conflicts` causes a hard refusal with no DAG issued

- **WHEN** a request touches both intent X and Z where X has `relates_to: [{kind: conflicts, target: Z}]`
- **THEN** the run returns `DuskError { kind: "decomposer_bead_conflict" }`
- **AND** no beads are issued for the pair

#### Scenario: `supersedes` excludes the superseded target

- **WHEN** a request touches intent X where X has `relates_to: [{kind: supersedes, target: W}]`
- **THEN** intent W is excluded from the active set even if otherwise touched

#### Scenario: `sibling` is context-only — no auto-expand

- **WHEN** a request touches intent X where X has `relates_to: [{kind: sibling, target: S}]`
- **THEN** intent S does NOT enter the active set
- **AND** no bead is issued for S
- **AND** no scope-expansion edge is added for the sibling relation

#### Scenario: Path `parent` pulls the ancestor into scope

- **WHEN** a request touches a child intent C whose hierarchical parent is P
- **THEN** P enters the active set and a scope-expansion edge from C's bead to P's bead is added

#### Scenario: Test-pyramid children are auto-added

- **WHEN** a request touches an implementation intent X that has a `X/unit-tests` child intent
- **THEN** the unit-tests child is auto-added to the active set with a bead dependency on X's bead

### Requirement: The bead DAG combines typed, file-overlap, and claim-overlap edges with conflict detection before any worktree exists

Step 2 SHALL produce a bead DAG combining three orthogonal edge sources: (1) typed-`relates_to` edges per the rules above; (2) **file-overlap serialization edges** added between every pair of beads whose predicted claimant file sets (computed via the snapshot) overlap; (3) **cross-bead claim-overlap precondition** — focal-claim overlap on the same `(intent_path, aspect_id)` → HARD `decomposer_bead_conflict`; support-claim overlap on the same file region → advisory warning surfaced in the run summary. All three SHALL be computed at DAG-build time, before any worktree is created. (RFC §6.2, §8.9; design D2; **P3-T3**, **P3-T4**.)

#### Scenario: File-overlap serialization edges sequence would-be parallel writers

- **WHEN** two intents have claimants in the same file (a cross-cutting `observability` intent + an impl intent touching the same module)
- **THEN** the DAG contains a serialization edge between their beads
- **AND** the two beads do not get concurrent worktrees on that file

#### Scenario: Focal-claim overlap is a hard refusal

- **WHEN** two beads would produce focal `@intent X [aspect-a]` claims on the same code region
- **THEN** the run returns `DuskError { kind: "decomposer_bead_conflict" }`
- **AND** no DAG is issued for the pair

#### Scenario: Support-claim overlap is an advisory warning, not a refusal

- **WHEN** two beads would produce `@intent-support X [aspect-a]` claims on the same file region (focal claims do not conflict)
- **THEN** the DAG is issued
- **AND** the run summary carries an advisory `support_overlap` warning naming the two beads and the file region

#### Scenario: Conflict detection precedes worktree creation

- **WHEN** a request would produce a focal-claim conflict (P3-T4) or a `conflicts` `relates_to` violation (P3-T2)
- **THEN** the `DuskError` is returned before any `git worktree add` command is executed
- **AND** no `dusk/<bead-id>` branch is created

### Requirement: An unresolved intent reference pauses the pipeline with a disk checkpoint

When the Decomposer encounters an intent reference that cannot be resolved against the snapshot, it SHALL write an `ImplementCheckpoint` (RFC §10.1.1; see `implement-checkpoint`) and return `DuskError { kind: "implement_paused_for_authoring", details: { resume_token, unresolved_refs[], suggested_dialog_seed } }`. No worktree is created. (RFC §10.1.1; design D4; **P3-T5**.)

#### Scenario: Unresolved intent emits a resumable pause

- **WHEN** `dusk_implement({ request })` references an unauthored behavior
- **THEN** the call returns `DuskError { kind: "implement_paused_for_authoring", details: { resume_token, unresolved_refs[] } }`
- **AND** `.ia/runtime/implement/<resume_token>.json` exists carrying `original_request`
- **AND** no bead DAG was issued
- **AND** no `dusk/<bead-id>` worktrees were created

### Requirement: `suggested_dialog_seed` content is enriched with surrounding intent context

The Decomposer's unresolved-intent escalation path SHALL continue to write the `ImplementCheckpoint` shape unchanged per Phase 3 (the JSON shape is frozen — Phase-3 D4). **The `suggested_dialog_seed` *content* SHALL be enriched** from the Phase-3 naive `unresolved_refs.join(", ")` to a Stage-1 framing prompt produced by the pure function `enrichDialogSeed(unresolvedRefs, snapshot)` (per design D4). The function SHALL read each unresolved-ref's surrounding context from the session snapshot (parent, siblings, `relates_to`-linked intents, the original request) and produce a business-vocabulary framing of what's missing. The shape stays frozen — only `suggested_dialog_seed`'s string content evolves. (RFC §10.1.1; design D4; Phase-3 `bead-decomposition` modification.)

#### Scenario: A missing leaf intent's seed names parent + sibling context

- **WHEN** `dusk_implement({request: "add cursor encoding for paginated lists"})` is called and the Decomposer encounters the unresolved reference `api/pagination/cursor-only/cursor-encode` (whose parent `api/pagination/cursor-only` exists with a sibling `cursor-decode`)
- **THEN** the resulting `ImplementCheckpoint.suggested_dialog_seed` references the parent intent's domain and the sibling's existence in business-vocabulary terms
- **AND** the string is non-empty
- **AND** the surrounding `ImplementCheckpoint` shape is unchanged from Phase 3 (every field present per RFC §10.1.1)

#### Scenario: Multiple unresolved refs produce a coherent multi-ref seed

- **WHEN** the Decomposer encounters two unresolved references in the same request
- **THEN** the `suggested_dialog_seed` string references both and explains what's missing for each

### Requirement: The Decomposer unresolved-intent escalation path invokes the real Author flow

The harness-side recovery for `implement_paused_for_authoring` SHALL be the real `dusk_author_start` / `_continue` / `_finalize` flow shipped in §author-mcp-surface — NOT a stub. Phase 4 SHALL remove the Sprint-5 stub that returned a placeholder string from the unresolved-ref path. After the user drives the dialog through `dusk_author_finalize`, the harness invokes `dusk_implement({resume_token})` and the Decomposer's re-run of the unresolved-ref check resolves successfully. (RFC §10.1.1; design D6 of Phase 3; **P4-T8** cross-tool integration.)

#### Scenario: Pause → drive Author → resume completes the pipeline

- **WHEN** `dusk_implement({request})` is called against an unresolved-intent request, returns `implement_paused_for_authoring`, the harness drives the real `dusk_author_*` flow to author the missing intent, and then calls `dusk_implement({resume_token})`
- **THEN** the Decomposer re-runs the unresolved-ref check and finds the now-authored intent
- **AND** the pipeline proceeds to Step 2 and completes
- **AND** the checkpoint file is deleted on Step-1 transition (single-use per Phase 3's `implement-checkpoint`)
