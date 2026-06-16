---
name: best-practices-application
---

# Industry-practice application (Stage 3)

Stage 3 injects industry practice from your TRAINING knowledge plus this skill
— there is NO runtime canonical-library lookup, no fetch, no pattern files read
at runtime (RFC §8.11). Present practice as a PROPOSAL the user can accept,
reject (greenfield), or selectively accept. A rejection means Stage 4 drafts
from the Stage-1 framing alone — never fabricate a substitute match.

## Canonical decomposition patterns

### Cursor pagination
Decompose into: a parent contract (`cursors are opaque tokens; list endpoints
accept a single cursor parameter`), an encode leaf (typed state → opaque
base64url token), and a decode leaf (token → typed state | typed error).
Key clauses: round-trip (encode output is decode input), opacity (clients
never parse cursors), stability under concurrent inserts. Pair with a
`polarity: negative` prohibition on offset pagination where the team wants
cursor-ONLY.

### Idempotency on writes
Model as a CONDITIONAL intent: `compose: implies` with antecedent
`is decorated with api/write-endpoint` and consequents "validate an idempotency
key on the Idempotency-Key header" + "persist the key and response under a
stable lookup" + "return the stored response on replay". Do not bake it into
each endpoint's own intent — the implies form keeps the rule total over future
write endpoints.

### Observability on cross-cutting concerns
Structured logging as its own intent (`observability/structured-logging`):
JSON-shaped log lines, a stable event vocabulary, correlation/request ids
propagated. Condition heavier tracing on decoration
(`is enclosed by a decoration of observability/traced`). Forbid PII in logs as
an affirmative triple with `polarity: negative`.

### Notification / outbox delivery
Persist-before-publish ordering as the load-bearing clause; an explicit retry
intent (bounded retries, dead-letter on exhaustion); delivery receipts as a
separate leaf so transports can vary.

## How to present the proposal

1. Name the pattern and the decomposition (paths you would create).
2. Quote the 2–4 load-bearing clauses you would draft, in triple-ready
   phrasing (affirmative slots; polarity called out explicitly).
3. State what you are NOT including and why, so selective acceptance has
   clean seams.
4. End with the three-way question: accept / reject (greenfield) / selectively
   accept (name the parts).

## On rejection (the greenfield branch)

Acknowledge, drop ALL scaffold content, and draft at Stage 4 strictly from the
user's framing and tension resolutions. Do not re-propose the rejected pattern
in different words, and do not consult any external source to find another.
