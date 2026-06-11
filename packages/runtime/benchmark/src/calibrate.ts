import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  AuditThresholdsSchema,
  duskError,
  err,
  ok,
  type AuditThresholds,
  type RuntimeResult,
} from "@dusk/core-schema";

import { meanPairwiseOverlap, shannonEntropy, type AuditCall } from "./auditAxes.js";
import { defaultThresholdsPath } from "./auditProtocol.js";
import { buildSeededManifest, seededViolationsRoot } from "./fixtureManifest.js";
import type { AuditVariant, Clock, FixtureVerifierCall } from "./auditRunner.js";

/**
 * `dusk benchmark --calibrate-audit` — Phase 5 design D1/Q4. Runs over the
 * manifest-DECLARED calibration split ONLY (`calibration: true` fixtures — the
 * held-out controversial/known-good set) and writes the frozen
 * `audit-thresholds.json` with provenance. Calibration may be re-run freely;
 * the protocol only forbids scoring test data first. Confidence intervals are
 * reported alongside the bars (design risk mitigation) — when an interval is
 * too wide to freeze responsibly, widen the split before freezing.
 *
 * Bar derivation (all explicit numerics, never narrative judgment):
 *  - Axis 1 `max_entropy_known_bad`   = known-good mean entropy + 2σ + 0.05 —
 *    the determinism the Verifier exhibits on easy cases bounds what the audit
 *    demands on known-bad ones (capped at 1 bit).
 *  - Axis 1 `min_entropy_controversial` = controversial mean entropy − 2σ
 *    (floored at 0) — controversial fixtures must stay MODERATE, not zero.
 *  - Axis 2 `max_token_overlap_low_precision_flag` = calibration-wide mean
 *    pairwise overlap + 2σ (clamped to [0.3, 0.95]) — similarity above the
 *    organically-observed level combined with low precision flags the
 *    rubber-stamp quadrant.
 *  - Axis 3 bars are the RFC §7.5.1 constants, written explicitly:
 *    ≥0.80 fixtures aligned-4-of-5; ≤0.05 fixtures all-unaligned.
 */

export type CalibrateOptions = {
  root?: string;
  thresholdsPath?: string;
  n?: number;
  call: FixtureVerifierCall;
  clock: Clock;
};

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const stddev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const interval = (xs: number[]): [number, number] => {
  const m = mean(xs);
  const s = stddev(xs);
  return [Math.max(0, m - 2 * s), m + 2 * s];
};

export async function calibrateAudit(opts: CalibrateOptions): Promise<RuntimeResult<AuditThresholds>> {
  const manifest = buildSeededManifest(opts.root ?? seededViolationsRoot());
  if (!manifest.success) return manifest;

  const split = manifest.value.fixtures.filter((f) => f.calibration === true);
  if (split.length === 0) {
    return err(duskError("config_invalid", "no calibration-flagged fixtures declared in the manifest (design Q4)", { recoverable: false }));
  }

  const n = Math.max(10, opts.n ?? 10);
  const variant: AuditVariant = { name: "standard" };

  const entropies = { knownGood: [] as number[], controversial: [] as number[] };
  const overlaps: number[] = [];
  for (const fixture of split) {
    const calls: AuditCall[] = [];
    for (let i = 0; i < n; i += 1) calls.push(await opts.call(fixture, i, variant));
    const accept = calls.filter((c) => c.decision === "accept").length;
    const entropy = shannonEntropy([accept, calls.length - accept]);
    (fixture.ground_truth_outcome === "verifier_accept" ? entropies.knownGood : entropies.controversial).push(entropy);
    overlaps.push(meanPairwiseOverlap(calls.map((c) => c.rationale)));
  }

  const thresholds: AuditThresholds = {
    schema_version: 1,
    calibrated_at: new Date(opts.clock.now()).toISOString(),
    calibration_fixture_ids: split.map((f) => f.id),
    frozen: true,
    axis1_variance: {
      max_entropy_known_bad: Math.min(1, mean(entropies.knownGood) + 2 * stddev(entropies.knownGood) + 0.05),
      min_entropy_controversial: Math.max(0, mean(entropies.controversial) - 2 * stddev(entropies.controversial)),
    },
    axis2_similarity: {
      max_token_overlap_low_precision_flag: Math.min(0.95, Math.max(0.3, mean(overlaps) + 2 * stddev(overlaps))),
    },
    axis3_citation: {
      // RFC §7.5.1 constants, written explicitly as part of the freeze.
      min_pct_fixtures_aligned_4of5: 0.8,
      max_pct_fixtures_all_unaligned: 0.05,
    },
    confidence_intervals: {
      known_good_entropy: interval(entropies.knownGood),
      controversial_entropy: interval(entropies.controversial),
      calibration_token_overlap: interval(overlaps),
    },
  };

  const validated = AuditThresholdsSchema.parse(thresholds);
  const path = opts.thresholdsPath ?? defaultThresholdsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  return ok(validated);
}
