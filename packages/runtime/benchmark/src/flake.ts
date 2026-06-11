import { FlakeCharacterizationSchema, duskError, err, ok, type FlakeCharacterization, type RuntimeResult } from "@dusk/core-schema";

import type { AuditVariant, FixtureVerifierCall } from "./auditRunner.js";
import { buildSeededManifest, seededViolationsRoot } from "./fixtureManifest.js";

/**
 * P5-T8 — the confirmation-pass flake-rate characterization. Measures the
 * VARIANCE ASSUMPTION behind the N=2 confirmation pass (real-Verifier rejects
 * on clean code are rare; confirmations usually override them) against the
 * real model. REPORT-ONLY, never gated: the artifact carries `gating: false`
 * as a literal, and no suite anywhere consumes the rate values — the
 * confirmation-pass MECHANISM was gated in P3-T14/T15 with the double.
 *
 * Protocol: N first-call verdicts per CLEAN (known-good) fixture; for each
 * first-call reject, the N=2 confirmation protocol runs and the outcome is
 * recorded. Tolerance bands are normal-approximation 95% intervals.
 */

export type FlakeOptions = {
  root?: string;
  /** First-call verdicts per clean fixture (high-N characterization). */
  n: number;
  call: FixtureVerifierCall;
};

const band = (successes: number, trials: number): [number, number] => {
  if (trials === 0) return [0, 1];
  const p = successes / trials;
  const half = 1.96 * Math.sqrt((p * (1 - p)) / trials);
  return [Math.max(0, p - half), Math.min(1, p + half)];
};

export async function characterizeFlakeRate(opts: FlakeOptions): Promise<RuntimeResult<FlakeCharacterization>> {
  const manifest = buildSeededManifest(opts.root ?? seededViolationsRoot());
  if (!manifest.success) return manifest;
  const clean = manifest.value.fixtures.filter((f) => f.ground_truth_outcome === "verifier_accept");
  if (clean.length === 0) return err(duskError("config_invalid", "no clean (known-good) fixtures available for the flake characterization", { recoverable: false }));

  const variant: AuditVariant = { name: "flake-characterization" };
  let firstCalls = 0;
  let firstCallRejects = 0;
  let dismissals = 0;

  for (const fixture of clean) {
    for (let i = 0; i < opts.n; i += 1) {
      firstCalls += 1;
      const first = await opts.call(fixture, i, variant);
      if (first.decision !== "reject") continue;
      firstCallRejects += 1;
      // The N=2 confirmation protocol on the same fixture.
      const confirmations = [await opts.call(fixture, i, variant), await opts.call(fixture, i, variant)];
      const confirmingRejects = confirmations.filter((c) => c.decision === "reject").length;
      if (confirmingRejects === 0) dismissals += 1; // both overrode → flaky_verdict_dismissed
    }
  }

  return ok(
    FlakeCharacterizationSchema.parse({
      gating: false,
      n_first_calls: firstCalls,
      first_call_reject_rate: firstCalls === 0 ? 0 : firstCallRejects / firstCalls,
      confirmation_dismissal_rate: firstCallRejects === 0 ? 0 : dismissals / firstCallRejects,
      tolerance_bands: {
        first_call_reject: band(firstCallRejects, firstCalls),
        confirmation_dismissal: band(dismissals, firstCallRejects),
      },
    }),
  );
}
