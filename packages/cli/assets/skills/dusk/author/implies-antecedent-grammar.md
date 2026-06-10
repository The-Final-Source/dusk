---
name: implies-antecedent-grammar
---

# `compose: implies` antecedent grammar

Antecedent triples accept ONLY the closed predicate vocabulary, all evaluated by
deterministic index lookup (never LLM judgement):

- `is decorated with` &lt;intent-path&gt;[&lt;aspect&gt;]
- `claims any aspect of` &lt;intent-path&gt;
- `is enclosed by a decoration of` &lt;intent-path&gt;

Disallowed (parser-rejected): type-system facts, control-flow facts, behavioral
claims (those belong in consequents), and cross-file references. A
`polarity: negative` antecedent triple is a set-complement query ("the unit is
NOT decorated with X").
