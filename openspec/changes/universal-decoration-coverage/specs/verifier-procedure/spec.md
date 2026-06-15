## ADDED Requirements

### Requirement: Structural (comment-less) records are verified mechanically, never by the semantic Verifier

A `DecorationRecord` tagged `verify: "structural"` (comment-less sidecar records) SHALL be excluded from the semantic Verifier's prompt. Such records carry no architectural triple to judge; their verification is mechanical — the anchor resolves against the live target, coverage tiles, and the existing Stage-2 build/test runs — and is reported on the mechanical/structural channel only, never blended into semantic adherence. The semantic Verifier's behavior for `verify: "semantic"` records (inline/directory decoration with triples) is unchanged. (RFC App. D.28; design D6.)

#### Scenario: A config sidecar claim is not sent to the semantic Verifier

- **WHEN** the Verifier procedure assembles evidence for a run that includes `verify: "structural"` sidecar records
- **THEN** those records are not included in the semantic prompt
- **AND** their satisfaction is determined mechanically (anchor resolution + the Stage-2 build/test), reported separately from semantic verdicts
