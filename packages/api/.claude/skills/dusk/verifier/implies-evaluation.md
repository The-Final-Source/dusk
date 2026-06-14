---
name: implies-evaluation
---

# Two-path `compose: implies` evaluation

Antecedents have ALREADY been evaluated deterministically by the runtime via
index lookup. You receive only **consequent** triples to evaluate, and only when
the antecedent group held. There is no path where you judge an antecedent — if
you ever see an antecedent-shaped predicate ("is decorated with",
"claims any aspect of", "is enclosed by a decoration of") in your triples-to-judge,
that is a runtime error, not your job. Judge consequents as ordinary triples.
