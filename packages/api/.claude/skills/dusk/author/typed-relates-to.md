---
name: typed-relates-to
---

# Typed `relates_to` edges

Intents relate through EXACTLY five typed kinds. There is NO `refines` kind —
hierarchical refinement is expressed by the slash-namespaced path itself
(`api/pagination/cursor-only/cursor-encode` refines its parent by position).
Stage 4.5 bounces any other kind back to you with this skill named.

## The five kinds and when to emit each

- `parent` — points at a SEMANTIC parent that is not the path parent. Rare:
  use only when an intent genuinely belongs under a second umbrella. The path
  parent is implicit; never emit a `parent` edge to it.
- `implies` — satisfying this intent requires the target to hold too. The
  Decomposer auto-pulls `implies` targets into scope, so emit it when work on
  this intent MUST co-schedule the target (e.g. cursor encoding implies the
  decode contract it must round-trip with).
- `conflicts` — the two intents cannot both be active in one change set. The
  Decomposer hard-refuses a request touching both. Emit during Stage-2 tension
  resolution when the user chooses "these are mutually exclusive".
- `supersedes` — this intent replaces the target; the target drops out of the
  active set wherever this one is in scope. Emit when the user resolves an
  overlap with "the new rule wins".
- `sibling` — context-only ("see also"). No scope expansion, no scheduling
  effect. The safe default for "related but independent".

## Reciprocal edges

Edges are directional, and some have a meaningful reciprocal on the target:

- A `implies` B → propose `sibling` (or `parent`) on B pointing back at A, so
  readers of B discover A. Ask the user before adding it — never add silently.
- A `conflicts` B → the reciprocal `conflicts` edge on B is strongly
  recommended (conflict detection walks from EITHER endpoint).
- A `supersedes` B → no reciprocal; the superseded intent stays untouched.

## Decision table for Stage-2 tension resolutions

| User's resolution of a tension | Edge to emit |
|---|---|
| "extend the existing intent" | author under its path; no edge needed |
| "the new rule replaces it" | `supersedes` → existing |
| "both, but never together" | `conflicts` → existing (+ reciprocal) |
| "new work depends on it" | `implies` → existing |
| "just related" | `sibling` → existing |

## Worked example

```yaml
id: api/pagination/cursor-only/cursor-encode
relates_to:
  - kind: implies
    target: api/pagination/cursor-only/cursor-decode
```

WRONG: `kind: refines` (does not exist — the path already encodes refinement);
WRONG: `kind: parent` to `api/pagination/cursor-only` (it is the path parent —
implicit). When in doubt between `implies` and `sibling`, ask: "can this intent
be satisfied while the target is violated?" If yes → `sibling`.
