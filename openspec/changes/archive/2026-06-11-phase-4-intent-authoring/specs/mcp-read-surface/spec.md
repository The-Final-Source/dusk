## MODIFIED Requirements

### Requirement: `dusk://dialogs/active` and `dusk_list_dialogs` enumerate outstanding Author dialogs

The MCP server SHALL expose `dusk://dialogs/active` resource and a paired `dusk_list_dialogs` read-only tool that enumerate every dialog directory present under `.ia/runtime/dialogs/` with one entry per directory carrying `{ dialog_id, request, current_stage, created_at, last_touched_at }`. When no dialogs exist, the response SHALL be empty. (RFC §10.1; design D9; Phase-3 `mcp-read-surface` extension.)

#### Scenario: Outstanding dialogs appear in the listing

- **WHEN** a `dusk_author_start` invocation has created a dialog and `dusk_list_dialogs({})` is called
- **THEN** the response contains at least one entry whose `dialog_id` matches the created dialog
- **AND** every field of the entry is populated from the dialog's persisted state

#### Scenario: Idle response is empty

- **WHEN** no dialog directories exist under `.ia/runtime/dialogs/`
- **THEN** `dusk_list_dialogs({})` returns `{ dialogs: [] }`

#### Scenario: Resource and paired tool agree on the dialog listing

- **WHEN** `dusk://dialogs/active` is read and `dusk_list_dialogs({})` is called against the same server
- **THEN** the two parsed payloads contain the same set of `dialog_id`s and the same per-dialog field set
