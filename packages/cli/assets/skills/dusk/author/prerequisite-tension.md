---
name: prerequisite-tension
---

# Prerequisite tensions (the request depends on an intent that doesn't exist yet)

Stage-2 tension detection runs in **two directions**. The four classes in
`tension-detection` cover tensions against intents that *exist*. This skill
covers the fifth class — **`prerequisite`** — a tension against an intent the
request **depends on but that is absent** from the tree.

This is fully general: it is about **intent dependencies**, not about any
"bootstrap" or project state. The dialog's currency is intents; a missing
dependency is just an intent that needs to be authored before the one in front of
you. The orchestration flow knows nothing about it — a `prerequisite` tension is
an ordinary surfaced finding that the existing flow turns into a user decision.

## The signal you are given

The Stage-2 `intent_census` context carries every intent path in the tree and an
`is_empty` flag. Use it (plus your own reasoning and the grep candidates) to judge
whether the request depends on an intent the census lacks.

## When to surface a `prerequisite` tension

When the request plainly requires a capability/decision that no intent in the
census provides yet. Examples (general, not exhaustive):

- An endpoint intent that depends on a persistence-layer intent that isn't
  authored.
- A feature intent that depends on an auth/session intent that isn't authored.
- The **canonical greenfield case**: an empty (or near-empty) census — the very
  first behavior intent depends on the project's foundation (tech-stack/module
  setup, app bootstrap, persistence) that has not been authored yet. This is just
  the most common prerequisite, not a special mode.

## How to surface it

Emit a tension with `classification: "prerequisite"`:

- `target` — the proposed path of the missing intent (e.g. `app/db-client`,
  `app/bootstrap`, `auth/session`).
- `excerpt` — what the request presupposes that the census lacks.
- `resolution_options` — e.g. "author `<prerequisite>` first, then return to this
  request" / "proceed now and author `<prerequisite>` separately".

In your `question`, recommend authoring the prerequisite(s) **first**, in
dependency order. For the greenfield foundation that order is typically
project/stack → app bootstrap → persistence → behavior. Never silently draft an
intent that depends on an absent one — that pushes the whole dependency onto the
implementation as un-owned support code.

## When NOT to fire

- The census already contains the dependency → no prerequisite tension; classify
  any real tension against it normally (overlap/gray/etc.).
- The request *is itself* the foundational/prerequisite intent the user is
  authoring → no gap; this is the dependency being laid.
