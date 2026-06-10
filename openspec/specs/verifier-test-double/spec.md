# verifier-test-double Specification

## Purpose
TBD - created by archiving change phase-2-runtime-verification. Update Purpose after archive.
## Requirements
### Requirement: A scripted-verdict Verifier double implements the same factory interface as the real Verifier

`packages/runtime/verifier-test-double` SHALL export a scripted-verdict Verifier factory that implements the same `VerifierFactory` interface as the real Verifier — the test seam Phase-3 control-flow tests bind to (RFC §6.4–§6.6 control-flow tests; design D5). The double SHALL accept a `fixtureScript` of pre-baked Verdicts and SHALL return them in order from successive Verifier invocations, performing zero model calls. This delivers the Verifier double deferred from Phase 1's design D7. (Phase 1 design D6/D7; design D5; Plan P2 scope.)

#### Scenario: A scripted script returns its verdicts in order with zero LLM cost

- **WHEN** a scripted-verdict factory is constructed with three verdicts and three successive Verifier invocations are made through `spawnSubAgent`
- **THEN** each invocation returns the next scripted Verdict in order
- **AND** no `SubAgentTrace` records a non-zero `prompt_tokens` or `completion_tokens` for any of them
- **AND** `cost_usd` is zero across the three traces

### Requirement: The double is selected via factory injection at the spawn boundary

`spawnSubAgent` SHALL accept an optional `verifierFactory?: VerifierFactory` parameter. When provided, the spawn pipeline SHALL use the injected factory for Verifier spawns; otherwise it SHALL default to the real Verifier. The selection MUST NOT alter the trace emission path or the assembled spawn payload — both real and doubled Verifier spawns SHALL produce the same `SubAgentTrace` field set. (Design D5.)

#### Scenario: Same trace shape across real and doubled Verifier spawns

- **WHEN** an identical Verifier spawn is performed once with the real factory and once with the scripted-verdict double
- **THEN** the two emitted traces carry the same field set (the same keys with type-matching values), differing only on token/latency/cost (zero for the double) and on the verdict content

### Requirement: The double exposes spawn-counter telemetry for Phase-3 control-flow assertions

The double SHALL expose a process-local `spawnCount` accessor that increments on every Verifier spawn routed through it. Phase-3 tests bind to this accessor to assert "no Verifier call was made" in flows where the procedure short-circuits (e.g., antecedent-false `implies`, ambiguous-antecedent errors). (Design D5; consumed by Phase 3.)

#### Scenario: spawnCount advances on every Verifier spawn through the double

- **WHEN** five Verifier spawns are routed through the double
- **THEN** the `spawnCount` accessor returns `5`

#### Scenario: spawnCount does not advance when antecedent-false short-circuits the procedure

- **WHEN** the procedure is invoked on an `implies` intent whose antecedent is false (verified via the §verifier-procedure path)
- **THEN** `spawnCount` does not increment for that consequent (the procedure issued no Verifier spawn)

### Requirement: The double honors fixture exhaustion and selector hints honestly

When the `fixtureScript` is exhausted, the double SHALL return a typed error (`DuskError { kind: "internal_error", recoverable: false }` carrying a clear message that the script underran), never an unscripted Verdict. Optionally, the double SHALL support a fixture-selector callback `(spawnContext) → Verdict` so tests can route verdicts by spawn context (intent path, aspect, iteration). (Design D5; "no silent behavior" per Dusk philosophy.)

#### Scenario: An exhausted script returns a structural error

- **WHEN** the script provides two Verdicts and a third Verifier spawn is requested
- **THEN** the third spawn returns a typed error indicating script exhaustion
- **AND** no implicit "default verdict" is fabricated

