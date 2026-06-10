---
name: polarity-decision
---

# Deciding polarity

A triple's slots are ALWAYS affirmative. Negative meaning is expressed
structurally — `polarity: negative` on the triple — never linguistically inside
a slot. The parser's matrix-predicate negation rule (RFC §3.1.1) rejects any
predicate containing a matrix-negation marker; Stage 4.5 bounces such drafts
back to you with this skill named.

## The decision procedure

1. State the rule in one sentence. If the sentence contains "must not",
   "never", "cannot", "forbids", "prevents", or "without", the rule is a
   prohibition: you are authoring a NEGATIVE-polarity triple.
2. Strip the negation from the sentence and describe the FORBIDDEN pattern
   affirmatively. The triple's slots describe what would be observed if the
   rule were violated.
3. Set `polarity: negative`. The Verifier reads this as "this pattern must NOT
   match" — a verdict-level negation, evaluated structurally.

## Affirmative-rewrite recipes

| User phrasing | WRONG (rejected at 4.5) | RIGHT |
|---|---|---|
| "must not use offset pagination" | predicate: "does not use" | predicate: "use", object: "offset-based pagination", polarity: negative |
| "never returns null" | predicate: "never returns" | predicate: "return", object: "null", polarity: negative |
| "must not log PII" | predicate: "refrains from logging" | predicate: "log", object: "personally identifiable information", polarity: negative |
| "responses lack stack traces" | predicate: "lacks" | predicate: "include", object: "a stack trace in the response body", polarity: negative |
| "cannot bypass the auth check" | predicate: "cannot bypass" | predicate: "bypass", object: "the auth middleware", polarity: negative |

## Constituent negation is legal (do NOT convert it)

Negation INSIDE a noun phrase in the subject or object slot is constituent
negation — it names a thing, it does not negate the claim. These stay
`polarity: positive`:

- object: "a function with no required arguments"
- object: "a sandboxed environment free of network access"
- subject: "endpoints without a request body"

Test: can you replace the phrase with a single noun ("a nullary function",
"an isolated sandbox") without changing the claim? If yes, it is constituent
negation — leave it affirmative.

## Worked example

Request: "list endpoints must not use offset pagination."

```yaml
triples:
  - id: offset-prohibited
    subject: "list endpoints"
    predicate: "use"
    object: "offset-based pagination (skip / limit / page-number)"
    polarity: negative
```

The slots read affirmatively ("list endpoints use offset-based pagination");
`polarity: negative` makes the intent assert that this must never hold.
