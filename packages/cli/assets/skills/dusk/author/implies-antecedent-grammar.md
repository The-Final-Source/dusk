---
name: implies-antecedent-grammar
---

# `compose: implies` antecedent grammar

A conditional intent ("if X, then Y must hold") uses `compose: implies` with an
`antecedent` group and a `consequent` group. The two groups obey DIFFERENT
grammars — this is the single most common Stage-4.5 bounce.

## The closed antecedent vocabulary

Antecedent predicates come from EXACTLY three forms, all evaluated by
deterministic index lookup (never LLM judgement):

- `is decorated with` `<intent-path>` or `<intent-path>[<aspect>]` —
  the unit carries a decoration claiming that intent (or that aspect).
- `claims any aspect of` `<intent-path>` — the unit claims at least one
  aspect of the intent.
- `is enclosed by a decoration of` `<intent-path>` — some enclosing scope
  (function, class, module) is decorated with the intent.

The antecedent OBJECT must be a resolvable reference: an intent path
(`api/write-endpoint`), a path with an aspect (`api/write-endpoint[validate]`),
or a directory glob (`api/payments/**`). Free text is rejected.

## What is parser-rejected in an antecedent

- Behavioral claims: "performs a write", "mutates state", "calls the database".
  Behavior belongs in the CONSEQUENT; the antecedent is a pure index fact.
- Type-system facts: "returns a Promise", "implements PaymentProvider".
- Control-flow facts: "is called from the request handler".
- Cross-file references and unresolvable paths.

If the user states a behavioral condition ("if the endpoint writes data…"),
your job is to find (or propose authoring) the decoration-level intent that
MARKS that behavior (`api/write-endpoint`) and condition on the mark.

## Negative antecedents

A `polarity: negative` antecedent triple is a set-complement query: "the unit
is NOT decorated with X". Use it for fallback rules ("anything not marked
internal must validate auth").

## Worked example

Request: "if decorated `api/write-endpoint`, must validate idempotency."

```yaml
id: api/idempotency-on-writes
description: Write endpoints validate and persist an idempotency key.
obligation: must
compose: implies
antecedent:
  - id: is-write
    subject: "the endpoint"
    predicate: "is decorated with"
    object: "api/write-endpoint"
consequent:
  - id: validates-idempotency
    subject: "the endpoint"
    predicate: "validate"
    object: "an idempotency key on the Idempotency-Key header"
```

The consequent triples follow the NORMAL triple grammar — affirmative slots,
`polarity` for negation (see dusk/author/polarity-decision), free predicates.
Never put a closed-vocabulary predicate in a consequent, and never put a free
behavioral predicate in an antecedent.
