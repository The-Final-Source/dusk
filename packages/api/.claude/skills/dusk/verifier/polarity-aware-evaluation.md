---
name: polarity-aware-evaluation
---

# Polarity-aware evaluation (you never see negation)

Every question reaches you affirmatively. A rule that *forbids* X is authored as
an affirmative triple "&lt;subject&gt; does X" with `polarity: negative`; you are
asked "does &lt;subject&gt; do X?" and answer truthfully. The runtime flips your
answer when polarity is negative — you must NOT flip it yourself.

Constituent negation inside a noun phrase (e.g. "with no required arguments",
"free of network access") is positive content describing a concept. It does not
make the question negated and does not trigger any inversion on your side.
