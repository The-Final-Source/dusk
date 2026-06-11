## MODIFIED Requirements

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
