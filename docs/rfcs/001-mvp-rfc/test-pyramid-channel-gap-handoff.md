# Handoff — Observed Gap: Test-Pyramid Verification Channel (Phase 6 POC)

## How to use this document

This is an **investigation handoff**, not a design or a fix. It records an
**observed divergence** between the code an Engineer produced and the apparent
intended design, with citations, so a fresh session can investigate and resolve
it **from first principles**. It deliberately:

- States observations and code references as facts, separated from inferences.
- Labels every causal claim that has **not** been verified as open.
- Lists multiple plausible fix loci as **open questions**, with **no
  recommendation**, to avoid biasing the solver.

Do not treat anything here as a conclusion about root cause or solution. Verify
each cited fact independently; several relevant paths were **not** traced and
are flagged as such.

---

## 0. Minimal context

**Dusk** is a constraint-satisfaction system for spec-driven AI development.
Authors write **intents** (YAML; each has `triples` of subject/predicate/object,
optional polarity/quantifier/`verify`, and a `compose` rule). Code is
**decorated** with markers that link lines/regions to intent triples. A
**Verifier** judges whether decorated code satisfies its triples. An **Engineer**
(a headless `claude --print` agent) drafts code in a git worktree; a **short
cycle** re-drafts until the Verifier returns no failing triples; a post-hoc
**gate** hard-blocks undecorated/uncovered lines. Everything — including the
project's own config — is built "through dusk" as zero-hand-written code in a
greenfield proof-of-concept (Phase 6).

**Decoration markers** (the vocabulary): `intent`, `intent-support`,
`intent-file`, `intent-test`, `intent-test-file`, `intent-ignore`.

**Test pyramid:** intents whose path ends in a configured suffix
(`unit-tests` / `integration-tests` / `e2e-tests`, configured under
`test_pyramid.suffixes` in `dusk.config.yml`) are "test-pyramid intents". Their
triples typically read "the unit test **verifies that** <impl does X>".

**Recently landed (context only — do NOT assume it dictates this fix):** three
decisions (RFC App. D.29/D.30/D.31) introduced a **verification channel** on
triples (`verify: structural | semantic`) and established the principle that the
*channel is a property of the claim, declared by the author, not derived from
how the file happens to be decorated*. The present gap concerns a *different*
routing axis (test vs. non-test), which is structurally reminiscent but is **not
established** to share the same solution. Mentioned only so the solver is aware
of the adjacent design and its principle (and the "no silent behavior" project
rule), not to steer the answer.

**Repository state at handoff:**
- POC repo (`dusk-notifications-poc`, sibling of the `dusk` monorepo) is at
  commit `ceaeef5`: the foundation intent `project/typescript-esm-foundation`
  is built + committed (`803504d`, config files only — `package.json`,
  `tsconfig.json`, `vitest.config.ts`); the `app/bootstrap` tree of intents is
  authored + committed (`b86b3ee`); **no `src/` implementation or test code is
  committed.**
- A build of the bootstrap tree was run and **killed mid-flight**; its worktree
  was removed. The produced (mis-decorated) test files are recorded in §1 below.
- **No `dusk` code was changed** in response to this gap.

---

## 1. Observation (raw facts)

While building the `app/bootstrap` tree, the Engineer produced test files for the
test-pyramid intents. Observed marker usage, per produced test file:

| Test file (under `src/`) | `@intent` | `@intent-support` | `@intent-test` / `@intent-test-file` |
|---|---|---|---|
| `app/bootstrap/unit-tests/index.test.ts` | 1 | 11 | 0 |
| `app/bootstrap/integration-tests/index.test.ts` | 1 | 14 | 0 |
| `app/bootstrap/response-envelope/unit-tests/index.test.ts` | 1 | 9 | 0 |
| `app/bootstrap/error-middleware/unit-tests/index.test.ts` | 1 | 8 | 0 |
| `app/bootstrap/error-middleware/integration-tests/index.test.ts` | 1 | 10 | 0 |

In every file the single `@intent` is a **file-level claim of the test-pyramid
intent and its aspects**, e.g. the first line of
`app/bootstrap/error-middleware/unit-tests/index.test.ts`:

```
// @intent app/bootstrap/error-middleware/unit-tests [covers-log-to-stderr, covers-no-stack-trace, covers-serialize-error-envelope]
```

and the `@intent-support` markers annotate helper functions and individual
`describe`/`it` blocks, e.g.:

```
// @intent-support app/bootstrap/error-middleware/unit-tests ["console.error called before json", "verify", "that the error middleware calls console.error with the original error before sending the response body"]
it('calls console.error with the forwarded error before responding', () => { ... })
```

**No test file used `@intent-test` or `@intent-test-file`.**

The corresponding **test intents** (authored, committed) carry triples of the
form (example, `app/bootstrap/error-middleware/unit-tests/intent.yaml`):

```yaml
triples:
  - id: covers-log-to-stderr
    subject: the unit test
    predicate: verifies
    object: that the error middleware logs the original error ... to stderr before sending the response
  - id: covers-no-stack-trace
    subject: the unit test
    predicate: verifies
    object: that the error middleware does not include a stack trace in the response body
  - id: covers-serialize-error-envelope
    subject: the unit test
    predicate: verifies
    object: that the error middleware serializes a forwarded error into the canonical error envelope ...
```

Their paths end in configured pyramid suffixes (`unit-tests`,
`integration-tests`).

---

## 2. Apparent intended design (cited — verify independently)

In the `dusk` monorepo (`packages/...`):

- `TEST_MARKERS = new Set(["intent-test", "intent-test-file"])` —
  `core/index/src/derivedIndex.ts:63`.
- `testDiscovery(intentPath)` returns the records for that intent whose marker is
  in `TEST_MARKERS` — `core/index/src/derivedIndex.ts:132-133`.
- **Verifier routing:** in the CLI's `verifierFactory`, a test intent is routed
  to the Stage-1 test-body pre-pass **iff `testDiscovery` is non-empty** —
  `cli/src/implement.ts:352-356`:
  ```
  // Test intents are judged by the Stage-1 test-body pre-pass instrument ...
  if (ctx.index.testDiscovery(vctx.intentPath).length > 0) {
    const prepass = await realTestPrepassVerdict(...);
    return prepass.success ? prepass.value : prepass.error;
  }
  ```
  When `testDiscovery` is empty, control falls through to the ordinary
  structural/semantic routing below that branch.
- **The Stage-1 pre-pass** (`runtime/benchmark/src/testPrepass.ts`,
  `realTestPrepassVerdict`) judges whether each claimed test triple is
  *genuinely* verified by the test body — the test must be able to **fail**, must
  assert on a value **derived from the unit under test**, and is rejected if it is
  tautological, a mirror re-implementation, asserts on mocks/inputs instead of
  outputs, is no-throw-only/type-only, or has an empty suite. This is RFC §3.4
  ("two-stage test satisfaction").
- **Canonical decoration of a test file (intended):**
  `// @intent-test-file <test-intent-path>` (file scope) or `@intent-test`
  (declaration scope). Evidence:
  - Every fixture in
    `packages/fixtures/seeded-violations/two-stage-test/*/feature.unit.test.ts:1`
    begins with `// @intent-test-file demo/feature/unit-tests`.
  - Orchestrator unit tests construct test-intent claimants with
    `marker: "intent-test"` — `runtime/orchestrator/src/implement.test.ts:59`,
    `runtime/orchestrator/src/smoke.test.ts:172`.
- **Gate enforcement that exists:** Check 9 —
  `delivery/pre-tool-use/src/checks.ts:212-215` — enforces that **if** a record's
  marker is `intent-test`/`intent-test-file`, **then** its `intent_path` must end
  in a configured pyramid suffix. (Forward direction only; see §3.)

---

## 3. Observed divergence (mechanism, stated factually)

Joining §1 and §2:

1. The produced test files claim test-pyramid intents with `@intent` (a focal
   marker that is **not** in `TEST_MARKERS`), not `@intent-test`/
   `@intent-test-file`.
2. Therefore, for those test intents, `testDiscovery(intentPath)` is **empty**,
   and the pre-pass branch at `implement.ts:354` is **not taken**. Control falls
   through to ordinary verification (the `covers-*` triples are judged on the
   normal channel from the single `@intent` line's evidence).
3. Consequently the **Stage-1 test-body pre-pass does not run** for these
   intents.

**What is NOT established (do not assume):**
- Whether ordinary verification of the `covers-*` triples would have **accepted
  or rejected**. The build was killed before convergence; the accept/reject
  outcome of the non-pre-pass path on these intents was **not observed**.
- Whether the `@intent` decorations would also fail or pass the **gate** and
  other checks. Not observed to completion.
- The **causal reason** the Engineer chose `@intent` (see §5).

The only mechanism asserted here is: `@intent` on a test-pyramid intent ⇒
`testDiscovery` empty ⇒ pre-pass route not taken.

---

## 4. Evidence map (independently verifiable)

- **Intended marker on test files:**
  `packages/fixtures/seeded-violations/two-stage-test/*/feature.unit.test.ts:1`;
  `runtime/orchestrator/src/{implement.test.ts:59, smoke.test.ts:172}`.
- **Routing + discovery:** `cli/src/implement.ts:352-356`;
  `core/index/src/derivedIndex.ts:47-50, 62-63, 132-139`.
- **Pre-pass instrument:** `runtime/benchmark/src/testPrepass.ts`
  (`realTestPrepassVerdict`, `TEST_PREPASS_SYSTEM_PROMPT`).
- **Gate enforcement that exists (forward only):**
  `delivery/pre-tool-use/src/checks.ts:212-215`; the corresponding fixture
  `packages/fixtures/seeded-violations/manifest.json` entry
  `non_test_path_on_intent_test` (~line 200).
- **Engineer guidance surface (what the Engineer is told):**
  `ENGINEER_FILE_INSTRUCTION` — `cli/src/implement.ts:187-200` — describes
  `// @intent <path> [aspects]` for exported declarations/statements and the
  `<file>.intent` JSON sidecar for comment-less files; the marker names it
  mentions are `intent` and `intent-file` only. The Engineer's loaded skills
  (observed in traces) are `dusk/engineer/{decoration-completeness,
  statement-extraction, support-triple-authoring}` under
  `packages/cli/assets/skills/dusk/engineer/`. A grep for `intent-test` across
  `cli/src/implement.ts` and `packages/cli/assets/skills/dusk/engineer/`
  returned **no matches** at handoff time. *(This is an observation about
  guidance content, not an established root cause.)*

---

## 5. Open questions — resolve from first principles (NO assumptions, NO prescribed fix)

These are deliberately framed as questions. Several plausible loci are listed;
**none is recommended.** A correct solution should establish the root cause(s)
before choosing where to act, and consider that more than one layer may be
involved.

1. **Causal root — why `@intent`?** Examine (as inputs, not conclusions): the
   exact task/prompt the Engineer receives for a test-pyramid bead — does it
   convey that the intent is a test intent, and which markers to use? the
   content of the Engineer's instruction and skills; whether the Engineer is
   shown the test intent's triples/path. The grep result in §4 is evidence about
   guidance content, not a verdict.
2. **Is `@intent` ever legitimate on a test file?** e.g. a non-test helper, or a
   test file that also contains decoratable non-test code. Is the concern "wrong
   marker on the *test claim* specifically," or "any non-test marker claiming a
   *test-suffix intent*"? This distinction shapes any enforcement rule.
3. **Where should a fix live?** All open; possibly several together:
   - (a) Engineer guidance — a skill/instruction teaching the test markers.
   - (b) Gate enforcement — a *reverse* of Check 9 (a focal claimant of a
     test-suffix intent must be a test marker), and/or related validation.
   - (c) Verifier routing — should an unsatisfiable/ambiguous situation (a
     test-suffix intent with no test-marker claimant) be handled **explicitly /
     fail-loud** rather than silently routed to ordinary verification? (Relates
     to the project's "no silent behavior" rule.)
   - (d) Author flow / intent shape — does anything at authoring time set or
     should set an expectation that propagates to the Engineer? (See Q5.)
   - (e) **Derive** the test channel from the intent's path suffix rather than an
     explicit marker. *Note:* this is structurally analogous to the recent D.30
     move ("channel is a property of the claim, not the decoration"), but whether
     that analogy should drive this solution is **itself an open question**, not
     a recommendation — there are countervailing considerations (e.g. the
     existing explicit-marker design, Q2, and honesty about who declares intent).
4. **Blast radius — other `TEST_MARKERS` consumers.** Does the same silent
   degradation affect anything else that depends on test markers — e.g.
   `testChildrenByLayer` (`derivedIndex.ts:135-139`), the orchestrator's
   `test_intents_executed` / Stage-2 Vitest execution, adherence/test rollups,
   commit-trailer `Test-Suites-passed`? **Not traced.** A fix should check
   whether these also silently no-op when test markers are absent.
5. **Authoring side.** What does the test-pyramid authoring path produce/expect —
   the author skill `packages/cli/assets/skills/dusk/author/test-pyramid-proposal.md`,
   and the orchestrator's mechanical derivation of test children? Does any of it
   establish an expectation that should reach the Engineer? **Not traced.**
6. **Verification of harm.** Independently determine what ordinary (non-pre-pass)
   verification actually does with the `covers-*` triples — does it accept a
   tautological/mock-only test? Construct a minimal case rather than assuming.

---

## 6. Reproduction

- **End-to-end:** from the POC checkpoint `ceaeef5`, run `dusk implement` scoped
  to a test-pyramid intent (e.g. `app/bootstrap/error-middleware` and its
  `.../unit-tests`), then inspect the Engineer's decorations on the produced
  `*.test.ts` and the verifier route taken for the test intent.
- **Unit-level:** build a `DerivedIndex` containing a test-suffix intent whose
  only claimant has `marker: "intent"`, and confirm `testDiscovery` returns
  empty and the routing in `implement.ts` does not select the pre-pass.

---

## 7. State left by this session

- POC repo at `ceaeef5`; the bootstrap build was killed; worktree
  `bd_20260616090749006` removed (its produced artifacts are recorded in §1).
  `.ia/observability/traces.jsonl` reflects the killed run (left as-is).
- No `dusk` repository change was made for this gap.
- The POC build is paused at the test-pyramid layer pending this gap's
  resolution. Prior, unrelated decisions D.29/D.30/D.31 (structural verification
  channel) are already committed and are mentioned only as adjacent context.
