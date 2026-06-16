---
name: test-file-decoration
---

# Test-file decoration — claim a test intent with a test marker

A **test intent** is one whose authored path ends in a configured
`test_pyramid.suffixes` value (`…/unit-tests`, `…/integration-tests`,
`…/e2e-tests`). Its identity comes from the **suffix**, not from how you decorate
the file. The file that implements a test intent is the **test body** the Stage-1
pre-pass reads to judge whether the test genuinely verifies its `covers-*`
triples (RFC §3.4). The pre-pass can only find that body through a **test
marker** — so the marker is required.

**The rule:** a file implementing a test-suffix intent claims it with a test
marker, **never** `@intent`:

- `@intent-test-file <test-intent-path>` — file scope (the whole file is the
  test body for that intent). Use this for a test file dedicated to one test
  intent.
- `@intent-test <test-intent-path> [covers-…]` — declaration scope (a specific
  `test(...)`/`describe(...)` block is the body for those triples).

If you stamp `@intent` (a focal **non-test** marker) on a test-suffix intent, the
write is rejected at the gate (`non_test_marker_on_test_intent`), and even if it
slipped through, the routed pre-pass would fail loud
(`test_intent_no_test_marker`) because it could not locate a test body. So:
`@intent` never claims a test intent.

`@intent-support` and an `@intent` that claims a **non-test** intent (a path that
does not end in a configured suffix) are still legitimate inside a test file —
the rule fires only on the focal claim of the test-suffix intent itself.

## Worked example

The test intent `notifications/send/unit-tests` (triple `covers-persist-first`)
lives at `.ia/intents/notifications/send/unit-tests/intent.yaml`. Its test body
file claims it with a test marker:

```ts
// @intent-test-file notifications/send/unit-tests
import { send } from "../send.js";

test("persists the row before publishing", () => {
  const db = fakeDb();
  send({ db });
  // asserts an observable effect DERIVED FROM the unit under test
  expect(db.inserted).toHaveLength(1);
});
```

Wrong (rejected at write time — `@intent` is not a test marker):

```ts
// @intent notifications/send/unit-tests [covers-persist-first]   ← WRONG
```
