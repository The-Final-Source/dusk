---
name: polarity-decision
---

# Deciding polarity

If a rule expresses that something must NOT happen, author it as an affirmative
triple describing the forbidden pattern with `polarity: negative` — never as a
negated predicate. Matrix-predicate negation ("does not return null", "lacks a
discriminator", "fails to validate") is rejected at parse: rewrite the predicate
affirmatively and set `polarity: negative`. Constituent negation inside a noun
phrase is legal and stays positive (e.g. "a sandbox free of network access").
