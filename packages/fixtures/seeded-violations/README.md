# Seeded-violations fixture (Phase 5, design D7)

~60 seeded violations across four classes, each a self-contained decorated file +
intent files + a `fixture.yaml` carrying
`{id, class, ground_truth_outcome, ground_truth_defect_loc: {file, line}, description, calibration?}`.

- `mechanical/` — gate-caught (PreToolUse), expected 100%.
- `static-analysis/` — `S ⊄ D` erosion, caught by `dusk doctor --static-analysis`, NOT the gate.
- `verification/` — Verifier-caught semantic defects (incl. quantifier, implies-consequent, negative-polarity cases).
- `two-stage-test/` — tests that pass at runtime but fail the Verifier's test-body pre-pass.

Every seeded-bad fixture carries a `// SEEDED: <id>` marker comment on its defect
line. The manifest build (`@dusk/runtime-benchmark`) verifies each
`ground_truth_defect_loc` points at its marker line and **fails on any mismatch** —
ground truth cannot silently rot.

This package is **excluded from the pnpm workspace** (`!packages/fixtures/seeded-violations`
in `pnpm-workspace.yaml`): its code is deliberately broken and must never enter
`pnpm build`. The calibration split for the fresh-Verifier audit is declared via
`calibration: true` in fixture metadata (design Q4).
