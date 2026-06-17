## ADDED Requirements

### Requirement: A focal claimant of a test-suffix intent must be a test marker (reverse of Check 9)

The PreToolUse gate (and the headless `gateWorktreeEdits`) SHALL add the reverse of Check 9: a decoration record whose marker is a **focal non-test marker** (`intent` or `intent-file`) and whose `intent_path` ends in a configured `test_pyramid.suffixes` value SHALL be rejected with kind `non_test_marker_on_test_intent`, and a message directing the author to use `@intent-test-file <path>` (file scope) or `@intent-test` (declaration scope). This enforces, at write time, the invariant that a test-suffix intent's focal claimant is a test marker — so the body the Stage-1 pre-pass needs is reliably present. The forward Check 9 (a `intent-test`/`intent-test-file` marker's path must end in a configured suffix → `non_test_path_on_intent_test`) is unchanged; together they enforce *test-suffix intent ⟺ test-marker claimant present*. (RFC App. D.32, §4.6, App. A.8; design D4.)

#### Scenario: `@intent` claiming a test-suffix intent is rejected

- **WHEN** a write decorates a line with `// @intent app/x/unit-tests [covers-…]` (a focal non-test marker whose path ends in a configured test suffix)
- **THEN** the gate rejects with `non_test_marker_on_test_intent` naming the intent path
- **AND** the message directs the author to `@intent-test`/`@intent-test-file`

#### Scenario: Legitimate non-test decoration in a test file is NOT rejected

- **WHEN** a test file carries `@intent-support` lines, OR an `@intent` claiming a NON-test intent (a path that does not end in a configured suffix)
- **THEN** neither is rejected by this check (it fires only on a focal `intent`/`intent-file` whose `intent_path` IS a test-suffix intent)

#### Scenario: The correct test marker passes the gate

- **WHEN** a test file is decorated with `// @intent-test-file app/x/unit-tests`
- **THEN** the reverse check does not fire (the marker is a test marker)
- **AND** forward Check 9 confirms the path ends in a configured suffix
