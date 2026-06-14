---
name: triple-evaluation
---

# Evaluating a triple against code

Judge the affirmative question *"does &lt;subject&gt; &lt;predicate&gt;
&lt;object&gt; hold?"* against the focal evidence only.

1. Bind `subject` to the focal claimant line(s).
2. Decide whether the `predicate`/`object` relation is realized by that code.
3. Check cardinality against `quantifier` within `scope` (count occurrences;
   never infer count from prose).
4. Answer `pass`/`fail` on the affirmative claim. Do NOT invert for polarity —
   the runtime does that after you. Quote the decisive line in your rationale.
