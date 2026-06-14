---
description: Drive the Dusk intent-authoring dialog (wraps the dusk_author_* MCP tools)
argument-hint: <request> | --continue <dialog_id> <response> | --finalize <dialog_id>
---

# /dusk-author — intent-authoring dialog

A thin wrapper around the three Phase-4 MCP tools. Parse `$ARGUMENTS` and call
exactly one tool; print the response in a readable form.

- `/dusk-author <request>` → call `dusk_author_start({ request })`. Print the
  `dialog_id` and the Stage-1 framing question.
- `/dusk-author --continue <dialog_id> <response>` → call
  `dusk_author_continue({ dialog_id, response })`. Print the next question, or
  `finalize_ready` when Stage 5 is reached (then suggest
  `/dusk-author --finalize <dialog_id>`).
- `/dusk-author --finalize <dialog_id>` → call
  `dusk_author_finalize({ dialog_id })`. Print the created intent paths.

When the user's response is a structured choice (pyramid layers, tension
resolutions, an edited triple), pass it as the tool's `payload` argument —
e.g. `payload: { layers: ["unit-tests"] }`.

On a `DuskError` response, print its `kind`, `message`, and `recovery_hint` —
do not retry automatically. Do not modify any files yourself: the Author
runtime owns every write (only `.ia/intents/**/intent.yaml` is ever touched,
at finalize).
