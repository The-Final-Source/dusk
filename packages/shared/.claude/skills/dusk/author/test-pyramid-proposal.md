---
name: test-pyramid-proposal
---

# Test-pyramid proposal

Every IMPLEMENTATION intent drafted at Stage 4 gets a pyramid proposal: offer
`<intent>/unit-tests`, `<intent>/integration-tests`, and `<intent>/e2e-tests`
children and let the user pick the subset that fits. The pick is a REAL
branching decision — never draft all three by default, and never skip the
question. A pure-leaf utility usually warrants {unit} only; a service boundary
usually warrants {unit, integration}; a user-facing flow adds e2e.

## When NOT to propose

- The drafted intent IS a test-pyramid child (its last path segment is a test
  suffix) — children don't get grandchildren.
- The drafted intent is a pure `compose: implies` policy with no directly
  claimable implementation surface — coverage comes from the consequent's
  owning intents instead.

## Deriving canonical `covers-X` triples

Each child's triples mirror the parent's clauses one-to-one: for every parent
triple `<t>`, the child gets a triple `covers-<t.id>` asserting the layer
verifies that clause.

- subject: "the unit test" / "the integration test" / "the e2e test"
- predicate: "verifies" (always affirmative — see polarity-decision)
- object: the parent clause restated as an observable outcome. For a
  `polarity: negative` parent triple, the object states the ABSENCE check
  ("that list endpoints do not use offset pagination") — constituent negation
  in the object slot is legal; the covers-triple itself stays positive.

## What each layer's object should emphasize

- unit-tests → the pure contract: inputs, outputs, error shapes, invariants.
- integration-tests → the seam: real collaborators (DB, queue, HTTP) wired
  together, transactional behavior, ordering.
- e2e-tests → the user-observable flow end to end, including auth + transport.

## Worked example

Parent `notifications/send` with triple
`{id: persist-first, subject: the send service, predicate: persist,
object: the notification before publishing}` and the user picks
{unit, integration}:

```yaml
# notifications/send/unit-tests
triples:
  - id: covers-persist-first
    subject: the unit test
    predicate: verifies
    object: that the send service persists the notification before publishing

# notifications/send/integration-tests
triples:
  - id: covers-persist-first
    subject: the integration test
    predicate: verifies
    object: that a real database row exists before the broker receives the event
```

No e2e child is drafted — only the picked subset exists. The children live at
the parent's path + suffix, so the Decomposer auto-schedules them with the
parent; no `relates_to` edge is needed for the child→parent link.
