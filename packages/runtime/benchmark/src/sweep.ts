import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { duskError, err, ok, type FixtureClass, type RuntimeResult } from "@dusk/core-schema";
import { z } from "zod";

import type { AuditVariant, Clock, FixtureVerifierCall } from "./auditRunner.js";
import { buildSeededManifest, seededViolationsRoot, GroundTruthOutcomeSchema, type SeededFixture } from "./fixtureManifest.js";

/**
 * The per-model sweep engine — Phase 5 design D6. `dusk benchmark --models
 * m1,m2,…` runs one COMPLETE fixture sweep per model, sequentially (never
 * interleaved — clean per-model cost attribution, no cross-model rate-limit
 * interference). Every per-fixture verdict is stored in the run manifest
 * (`verdicts.jsonl`, keyed `(fixture_id, model)`); every report section is a
 * pure post-pass over that manifest — no fixture is re-run for any section.
 */

export const SweepRecordSchema = z
  .object({
    fixture_id: z.string(),
    model: z.string(),
    class: z.enum(["mechanical", "static-analysis", "verification", "two-stage-test"]),
    expected: GroundTruthOutcomeSchema,
    /** Which layer evaluated the fixture (the designed detection layer for its class). */
    layer: z.enum(["gate", "doctor", "verifier", "verifier-test-prepass"]),
    /** Verifier-layer decision (absent on gate/doctor legs). */
    decision: z.enum(["accept", "reject"]).optional(),
    /** Whether the designed layer produced the ground-truth outcome; null for controversial fixtures. */
    caught: z.boolean().nullable(),
    latency_ms: z.number().min(0),
    cost_usd: z.number().min(0),
  })
  .strict();
export type SweepRecord = z.infer<typeof SweepRecordSchema>;

export type SweepModel = { name: string; call: FixtureVerifierCall };

export type SweepDeps = {
  root?: string;
  /** Run directory (e.g. `.ia/observability/benchmark-runs/<run-id>`). */
  outDir: string;
  models: SweepModel[];
  /** The real PreToolUse gate leg (mechanical class). */
  gate: (fixture: SeededFixture) => { blocked: boolean };
  /** The static-analysis doctor leg (static-analysis class). */
  staticAnalyzer: (fixture: SeededFixture) => { flagged: boolean };
  /** Optional fixture filter (mini sets in tests). */
  filter?: (fixture: SeededFixture) => boolean;
  clock: Clock;
};

const variantFor = (model: SweepModel): AuditVariant => ({ name: model.name });

function expectedCaught(fixture: SeededFixture, decision: "accept" | "reject"): boolean | null {
  switch (fixture.ground_truth_outcome) {
    case "verifier_reject":
    case "verifier_test_reject":
      return decision === "reject";
    case "verifier_accept":
      return decision === "accept";
    case "controversial":
      return null; // no ground truth — recorded, never scored
    default:
      return null;
  }
}

export function verdictsPath(outDir: string): string {
  return join(outDir, "verdicts.jsonl");
}

/** Run the sweep: one complete pass per model, sequentially; records appended to verdicts.jsonl. */
export async function runBenchmarkSweep(deps: SweepDeps): Promise<RuntimeResult<{ records: SweepRecord[]; manifestPath: string }>> {
  const manifest = buildSeededManifest(deps.root ?? seededViolationsRoot());
  if (!manifest.success) return manifest;
  const fixtures = manifest.value.fixtures.filter(deps.filter ?? (() => true));
  if (fixtures.length === 0) return err(duskError("config_invalid", "the benchmark sweep matched no fixtures", { recoverable: false }));
  if (deps.models.length === 0) return err(duskError("config_invalid", "the benchmark sweep requires at least one model", { recoverable: false }));

  mkdirSync(deps.outDir, { recursive: true });
  const path = verdictsPath(deps.outDir);
  const records: SweepRecord[] = [];
  const emit = (record: SweepRecord): void => {
    records.push(record);
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  };

  // Sequential per-model sweeps — model m1's COMPLETE pass precedes m2's first call.
  for (const model of deps.models) {
    for (const fixture of fixtures) {
      const base = { fixture_id: fixture.id, model: model.name, class: fixture.class as FixtureClass, expected: fixture.ground_truth_outcome };
      if (fixture.class === "mechanical") {
        const started = deps.clock.now();
        const { blocked } = deps.gate(fixture);
        emit({ ...base, layer: "gate", caught: blocked, latency_ms: Math.max(0, deps.clock.now() - started), cost_usd: 0 });
        continue;
      }
      if (fixture.class === "static-analysis") {
        const started = deps.clock.now();
        const { flagged } = deps.staticAnalyzer(fixture);
        emit({ ...base, layer: "doctor", caught: flagged, latency_ms: Math.max(0, deps.clock.now() - started), cost_usd: 0 });
        continue;
      }
      const call = await model.call(fixture, 0, variantFor(model));
      emit({
        ...base,
        layer: fixture.class === "two-stage-test" ? "verifier-test-prepass" : "verifier",
        decision: call.decision,
        caught: expectedCaught(fixture, call.decision),
        latency_ms: call.usage?.latency_ms ?? 0,
        cost_usd: call.usage?.cost_usd ?? 0,
      });
    }
  }

  return ok({ records, manifestPath: path });
}

/** Load a stored run manifest (the post-passes' only input). */
export function readSweepRecords(outDir: string): SweepRecord[] {
  return readFileSync(verdictsPath(outDir), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => SweepRecordSchema.parse(JSON.parse(l)));
}
