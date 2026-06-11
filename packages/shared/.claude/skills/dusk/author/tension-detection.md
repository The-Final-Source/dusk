---
name: tension-detection
---

# Tension detection & classification

Stage 2 surfaces every existing intent the grep pass matched and classifies its
tension with the request into one of four classes. Every surfaced tension MUST
become a user decision — never silently resolve one.

## The four classes

- `conflict` — the existing intent and the new request cannot both hold.
  Example: existing `api/no-offset-pagination` (offset forbidden) vs a request
  "add page-number pagination to the admin list". The user must pick a side;
  the loser is superseded or the request is reframed.
- `overlap` — the existing intent already covers part of the request's ground.
  Example: authoring cursor encoding when `api/pagination/cursor-only` already
  governs cursor behavior. Default resolution: author UNDER the existing
  parent's path and inherit its scope rather than duplicating clauses.
- `gray` — the boundary between the two is ambiguous; the same code span could
  plausibly claim either. Example: a new "request-validation" intent next to an
  existing "input-sanitization" intent. Force a boundary decision: which intent
  owns which clause? Record the user's words in the resolution.
- `adjacent` — same domain, no shared ground. Example: cursor pagination next
  to `api/auth-required`. Usually resolves to a `sibling` edge or no edge.

## Classification procedure

For each grep candidate, read its description + triples and ask, in order:

1. Would satisfying the new request VIOLATE any triple of the candidate
   (respecting polarity)? → `conflict`.
2. Would any drafted triple duplicate or subsume a candidate triple? →
   `overlap`.
3. Could a single code span plausibly claim both intents for the same
   behavior? → `gray`.
4. Otherwise, same domain → `adjacent`; unrelated → drop the candidate.

## Resolution options to offer per class

- conflict → "supersede the existing intent" | "narrow the new intent's scope
  so they don't intersect" | "abandon this part of the request"
- overlap → "extend the existing intent (author under its path)" | "author a
  separate leaf + implies edge" | "supersede"
- gray → "draw the boundary at <user's words>; encode it in both descriptions"
- adjacent → "add a sibling edge" | "no relation"

Encode the user's pick verbatim into the draft's `tension_resolutions`
bookkeeping — Stage 4 reads it to place the new intent in the tree, and the
audit reads it later as the negotiation record.
