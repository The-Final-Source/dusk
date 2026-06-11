---
description: Run the Dusk benchmark harness — per-class detection rates, the three-axis fresh-Verifier audit, or the dogfood go/no-go evaluation.
argument-hint: "[--models <m1,m2,…>] [--audit-verifier-freshness | --calibrate-audit | --evaluate-dogfood]"
---

Run the `dusk benchmark` CLI with the arguments the user supplied (thin wrapper —
the CLI owns all behavior):

```bash
dusk benchmark $ARGUMENTS
```

Modes:

- **(default)** — one complete seeded-violations fixture sweep per model,
  sequentially; per-model per-class accuracy, per-role latency/cost, and the
  cross-model agreement matrix derive from one stored
  `.ia/observability/benchmark-runs/<run-id>/verdicts.jsonl` manifest.
- **`--audit-verifier-freshness`** — the standing three-axis fresh-Verifier
  audit (N≥10, temperature 0): verdict-variance entropy, rationale token
  overlap, structural citation precision (no LLM-judge). REFUSES to run without
  pre-registered frozen thresholds — run `--calibrate-audit` first.
- **`--calibrate-audit`** — calibrate the pass bars on the manifest-declared
  calibration split only and freeze `audit-thresholds.json` with provenance.
- **`--evaluate-dogfood`** — the deterministic go/no-go evaluation of the
  dogfood window (gating = exactly the four named thresholds; everything else
  is exploratory and labeled `gating: false`).

Print the command's summary output back to the user verbatim, then point at the
written report file for the full artifact.
