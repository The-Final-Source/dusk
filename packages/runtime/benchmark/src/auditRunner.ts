import {
  AuditReportSchema,
  duskError,
  err,
  ok,
  type AuditReport,
  type RuntimeResult,
  type SubAgentTrace,
} from "@dusk/core-schema";
import type { ImportGraph } from "@dusk/runtime-long-cycle";

import { fixtureAuditResult, quadrantFlag, scoreAxes, type AuditCall } from "./auditAxes.js";
import { defaultThresholdsPath, enforcePreRegistration } from "./auditProtocol.js";
import { buildSeededManifest, seededViolationsRoot, type SeededFixture } from "./fixtureManifest.js";
import { assembleOrganicCohort } from "./organicCohort.js";

/**
 * The standing three-axis fresh-Verifier audit — Phase 5 P5-T3 (RFC §7.5,
 * §7.5.1). N≥10 independent Verifier calls per known-bad fixture at
 * `temperature: 0`; Axis 1 verdict-variance entropy, Axis 2 rationale
 * token-overlap, Axis 3 structural citation precision — scored against the
 * PRE-REGISTERED frozen bars. NO LLM-judge anywhere: every score is a pure
 * transform over recorded calls. Pre-registration is enforced BEFORE any model
 * call — the refusal paths never reach a model.
 */

export type AuditVariant = {
  name: string;
  /** Optional Verifier system-prompt override (the planted rubber-stamp / no-citation variants). */
  systemPrompt?: string;
};

export type FixtureVerifierCall = (fixture: SeededFixture, callIndex: number, variant: AuditVariant) => Promise<AuditCall>;

export type Clock = { now: () => number };

export type RunAuditOptions = {
  /** Seeded-violations root (defaults to the checked-in fixture package). */
  root?: string;
  thresholdsPath?: string;
  /** Calls per fixture — the audit's own protocol mandates ≥10 (clamped up). */
  n?: number;
  /** Audited prompt variants; the first is the curated baseline. */
  variants?: AuditVariant[];
  call: FixtureVerifierCall;
  importGraphFor?: (fixture: SeededFixture) => ImportGraph;
  /** Trace stream for the organic confirmation-pass cohort (P5-T4). */
  traces?: SubAgentTrace[];
  clock: Clock;
  runId?: string;
};

const emptyGraph: ImportGraph = { imports: () => [], importedBy: () => [] };

/** The audit's scored set: the curated known-bad verification fixtures (never the calibration split). */
export function knownBadFixtures(root: string = seededViolationsRoot()): RuntimeResult<SeededFixture[]> {
  const manifest = buildSeededManifest(root);
  if (!manifest.success) return manifest;
  return ok(
    manifest.value.fixtures.filter(
      (f) => f.class === "verification" && f.ground_truth_outcome === "verifier_reject" && f.calibration !== true,
    ),
  );
}

export async function runFreshnessAudit(opts: RunAuditOptions): Promise<RuntimeResult<AuditReport>> {
  const scored = knownBadFixtures(opts.root);
  if (!scored.success) return scored;
  if (scored.value.length === 0) {
    return err(duskError("config_invalid", "the audit found no known-bad fixtures to score", { recoverable: false }));
  }

  // Pre-registration enforcement FIRST — refusals never reach a model (D1).
  const thresholds = enforcePreRegistration({
    thresholdsPath: opts.thresholdsPath ?? defaultThresholdsPath(),
    scoredFixtureIds: scored.value.map((f) => f.id),
  });
  if (!thresholds.success) return thresholds;

  const n = Math.max(10, opts.n ?? 10);
  const variants = opts.variants ?? [{ name: "standard" }];

  const byVariant = new Map<string, ReturnType<typeof fixtureAuditResult>[]>();
  for (const variant of variants) {
    const results: ReturnType<typeof fixtureAuditResult>[] = [];
    for (const fixture of scored.value) {
      const calls: AuditCall[] = [];
      for (let i = 0; i < n; i += 1) {
        calls.push(await opts.call(fixture, i, variant));
      }
      const graph = opts.importGraphFor?.(fixture) ?? emptyGraph;
      results.push(fixtureAuditResult(fixture.id, calls, fixture.ground_truth_defect_loc!, graph));
    }
    byVariant.set(variant.name, results);
  }

  const baseline = byVariant.get(variants[0].name)!;
  const organic = assembleOrganicCohort(opts.traces ?? []);

  const report: AuditReport = {
    schema_version: 1,
    run_id: opts.runId ?? `audit_${opts.clock.now()}`,
    generated_at: new Date(opts.clock.now()).toISOString(),
    n_per_fixture: n,
    curated: {
      // The curated baseline is computed WITHOUT the organic data (P5-T4).
      fixtures: baseline,
      scores: scoreAxes(baseline, thresholds.value),
    },
    quadrant_flags: variants.map((v) => quadrantFlag(v.name, byVariant.get(v.name)!, thresholds.value)),
    ...(organic ? { organic } : {}),
  };
  return ok(AuditReportSchema.parse(report));
}
