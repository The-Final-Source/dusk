---
name: foundation-gap-detection
---

# Foundation-gap detection (author the foundation first)

Stage-2 tension detection runs in **two directions**: against intents that
*exist* (the four classes in `tension-detection`) and against intents that
**should exist but don't** — the *foundation gap*. This is what makes greenfield
authoring robust: in Dusk the foundation of a project is not pipeline machinery,
it is simply **the first sequence of intents** the author writes. A behavior
intent authored before its foundation exists forces the implementation pipeline
to birth the whole application inside one bead — the failure this skill prevents.

## The signal you are given

The Stage-2 `foundation` context carries:

- `existing_intent_paths` — the full census of intents already in the tree.
- `empty_tree` — `true` when the tree has **no** intents at all.

`empty_tree: true` is the unambiguous case: this is the very first intent in an
empty project, so **any** behavior intent presupposes a foundation that does not
yet exist. For a non-empty tree, judge from the census whether the specific
foundation this request presupposes is present.

## What a behavior intent presupposes

Before an endpoint / handler / feature intent can be implemented, the project
needs foundational decisions captured **as intents**:

1. **Project / tech-stack setup** — language + module system, framework choice,
   directory/module structure, build/test config conventions.
2. **App bootstrap** — the application object + server entry the handlers mount
   into; the request/response + error conventions they share.
3. **Persistence layer** — the database client/connection and schema conventions
   the write/read paths depend on.

If the request presupposes any of these and the census lacks it, that is a
**foundation gap**.

## How to surface it

When you detect a foundation gap, do NOT silently draft the behavior intent. In
your Stage-2 `question`:

- Name the specific foundation that is missing.
- Recommend authoring the prerequisite foundation intents **first**, in
  dependency order: **project/stack → app bootstrap → persistence → behavior**.
- Offer to open those foundation dialogs now, then return to this request.

This is the proactive, authoring-time complement to the reactive mid-build pause
(when the Decomposer hits an intent that does not exist): the gap is caught
*before* any code is requested. It is a dialog responsibility — the pipeline
gains no greenfield special-case; the foundation is just the project's first
intents.

## When NOT to fire

- The census already contains the presupposed foundation (brownfield, or a later
  request in a project whose foundation is established) → no gap; proceed to
  normal tension classification.
- The request *is itself* a foundation intent (the user is authoring the stack /
  bootstrap / persistence) → no gap; this is the foundation being laid.
