---
name: verify-channel
---

# Choosing a triple's verification channel

Every triple is verified on one of two channels. The channel is a property of
the CLAIM — "is there behavior for an evaluator to judge?" — declared by YOU,
the author, in the intent. It is NOT derived from the file format (RFC App.
D.30). Declaring it is what lets config-through-dusk converge.

- **`verify: structural`** — the triple is true by the PRESENCE or SHAPE of a
  declaration or config file. Verified MECHANICALLY: its decoration's anchor
  resolves against the live target AND the target is decoration-covered. Zero
  LLM calls; converges on the first iteration.
- **(omitted) ≡ `semantic`** — the triple is true by the BEHAVIOR of code an
  evaluator must read and judge. The LLM Verifier reads the decorated region and
  decides. This is the default.

## The decision procedure

1. State the claim in one sentence.
2. **Litmus:** can you point at a concrete declaration, key, or region whose
   *mere existence/shape* makes the claim true — with nothing to *reason* about?
   - YES → `verify: structural`.
   - NO (you must judge what the code *does*) → leave it semantic.
3. If a triple is about the behavior of code that does not exist in this
   intent's scope yet (e.g. "source imports use a `.js` extension" inside a
   config intent), it is **misplaced**, not structural. Author it where its
   subject exists — typically as a `compose: implies` rule over the source
   files — never as a structural triple swept in by a whole-file config claim.

## Examples

| Claim | Channel | Why |
|---|---|---|
| package.json declares `"type": "module"` | structural | a key's presence/value |
| tsconfig sets `"strict": true`, `"module": "NodeNext"` | structural | config shape |
| vitest.config wires native-ESM test execution | structural | config file presence/shape — no behavior to judge |
| drizzle.config points at the schema + dialect | structural | config shape |
| the handler rejects unauthenticated requests | semantic | runtime behavior to read & judge |
| the repository inserts the row before publishing | semantic | ordering of behavior in code |
| relative imports in TS source carry a `.js` extension | semantic | behavior of source code — author on the source intent, not the config intent |

## Honesty

A structural pass means ONLY "covered + present", never "an LLM approved the
architecture". Structural and semantic verdicts are reported on separate
channels (mechanical vs semantic) and are NEVER blended. Because the channel is
declared in the version-controlled intent — before any code or model call — the
Engineer cannot downgrade a failing semantic claim to structural to escape a
verdict. Relate: [[polarity-decision]].
