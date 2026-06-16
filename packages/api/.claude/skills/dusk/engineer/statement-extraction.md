---
name: statement-extraction
---

# Statement extraction

Extract nested user-defined function calls into their own `const` statements so
each statement participates in a single intent. Loop-invariant work is hoisted
above the loop. A builder chain stays one statement only when its steps share the
same intent footprint; otherwise split it. The goal: one statement, one decorable
unit of intent.
