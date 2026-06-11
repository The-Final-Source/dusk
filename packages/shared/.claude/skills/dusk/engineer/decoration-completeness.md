---
name: decoration-completeness
---

# Decoration completeness

Every statement and every block inside a decorated declaration must carry
explicit decoration — there is no implicit coverage from the enclosing
declaration. Cross-cutting intents are declared at the function level and
supported at the touching lines via `@intent-support` with an inline NL triple.
A statement with no role is a defect: decorate it, or restructure (decompose)
until each statement has a single clean intent footprint.
