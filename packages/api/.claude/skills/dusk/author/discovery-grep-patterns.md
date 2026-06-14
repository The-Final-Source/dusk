---
name: discovery-grep-patterns
---

# Discovery grep patterns

Stage 2 discovery is a GREP pass over `intent.yaml` files under `.ia/intents/`
— full-text matching against descriptions and triple slot content. There is NO
vector index, NO embedding search, NO RAG layer (RFC §8.10): if you find
yourself wanting semantic search, stop and write a better grep.

## Deriving keywords from the framing

Start from the confirmed Stage-1 framing, not the raw request. Extract:

1. Domain nouns — "cursor", "pagination", "idempotency", "notification".
2. Their morphological variants — search "pagina" to catch
   paginate/pagination/paginated; "idempoten" for idempotent/idempotency.
3. Synonym sets the codebase actually uses — "auth" AND "login";
   "cursor" AND "token"; "delete" AND "remove" AND "purge".
4. The path vocabulary — segments of any intent paths the user mentioned
   (`api/pagination/...` → "pagination", "cursor-only").

Drop generic verbs ("add", "support", "use") — they match everything.

## Where to point the patterns

- `description:` lines — the highest-signal field; an intent's description
  names its domain in business vocabulary.
- Triple `subject:` / `object:` slots — catch intents whose description is
  terse but whose clauses name the concept.
- `relates_to.target` values — an intent POINTING at a matching path is in
  tension range even if its own text never uses the keyword.
- Path segments (directory names) — `**/pagination/**/intent.yaml` style
  matches catch whole subtrees.

## Iteration discipline

- First pass broad (stemmed keywords, case-insensitive), then narrow: a
  result set above ~10 files means your keywords are too generic.
- ZERO matches is a valid, meaningful outcome — it means greenfield; advance
  to Stage 3 without inventing tensions. Never pad the candidate list.
- Every candidate you keep must be classifiable (conflict/overlap/gray/
  adjacent — see dusk/author/tension-detection). If you cannot say WHY a file
  matched, drop it.

## Worked example

Framing: "opaque cursor encoding for paginated list endpoints."

Keywords: `cursor`, `pagina` (stem), `opaque`, `token`, `encode`.

Matches: `api/pagination/cursor-only` (description: "cursors are opaque
tokens" — overlap candidate), `api/pagination/page-size-bound` (same subtree —
adjacent), `api/no-offset-pagination` (object slot: "offset-based pagination"
— adjacent, polarity reinforces the request). Each goes to classification with
the matched line quoted as its excerpt.
