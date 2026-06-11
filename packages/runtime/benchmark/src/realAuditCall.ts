import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseDecorations } from "@dusk/core-decoration";
import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import { loadIntentTree } from "@dusk/core-graph";
import { DEFAULT_VERIFIER_EVIDENCE_MAX_LINES, type Intent } from "@dusk/core-schema";
import { verifyIntent, type ModelClient } from "@dusk/runtime-verifier";

import type { AuditCall } from "./auditAxes.js";
import type { AuditVariant, FixtureVerifierCall } from "./auditRunner.js";
import type { SeededFixture } from "./fixtureManifest.js";
import { materializeFixtureProject } from "./fixtureProject.js";
import { withTransportRetry } from "./transportRetry.js";

/**
 * The real-model audit/benchmark call: materialize the fixture's mini-project,
 * build its derived index, and run the §3.3 Verifier procedure (`temperature:
 * 0`) over every intent the fixture's decorations claim. Each call is wrapped
 * in the pre-registered transport-failure protocol. Prompt variants substitute
 * the Verifier system prompt only — the evidence path is identical.
 */

type FixtureContext = {
  index: DerivedIndex;
  intents: Map<string, Intent>;
  intentIds: string[];
  readFile: (file: string) => string;
};

export function realFixtureVerifierCall(opts: {
  /** Scratch directory for materialized fixture projects. */
  workDir: string;
  modelClient: ModelClient;
  maxLines?: number;
}): FixtureVerifierCall {
  const contexts = new Map<string, FixtureContext>();

  const contextFor = (fixture: SeededFixture): FixtureContext => {
    const cached = contexts.get(fixture.id);
    if (cached) return cached;

    const projectDir = join(opts.workDir, fixture.id.replaceAll("/", "__"));
    const { sourceFiles } = materializeFixtureProject(fixture, projectDir);
    const tree = loadIntentTree(join(projectDir, ".ia/intents"));
    const records = sourceFiles.flatMap((rel) => parseDecorations(readFileSync(join(projectDir, rel), "utf8"), rel));
    const index = buildDerivedIndex(records, tree.intents);
    const intentIds = [...new Set(records.map((r) => r.intent_path))].filter((id) => tree.intents.has(id)).sort();
    const readFile = (file: string): string => {
      const full = join(projectDir, file);
      return existsSync(full) ? readFileSync(full, "utf8") : "";
    };
    const ctx: FixtureContext = { index, intents: tree.intents, intentIds, readFile };
    contexts.set(fixture.id, ctx);
    return ctx;
  };

  return async (fixture: SeededFixture, _callIndex: number, variant: AuditVariant): Promise<AuditCall> => {
    const ctx = contextFor(fixture);
    const rationales: string[] = [];
    const focalClaims: AuditCall["evidence"]["focal_claims"] = [];
    let anyReject = false;
    let latencyMs = 0;
    let costUsd = 0;

    for (const intentId of ctx.intentIds) {
      const intent = ctx.intents.get(intentId)!;
      const result = await withTransportRetry(() =>
        verifyIntent(intent, {
          index: ctx.index,
          readFile: ctx.readFile,
          maxLines: opts.maxLines ?? DEFAULT_VERIFIER_EVIDENCE_MAX_LINES,
          modelClient: opts.modelClient,
          ...(variant.systemPrompt ? { systemPrompt: variant.systemPrompt } : {}),
          onUsage: (usage) => {
            latencyMs += usage.latencyMs;
            costUsd += usage.costUsd;
          },
        }),
      );
      if (!result.success) {
        // A structural verifier error is NOT transport noise — fail the leg loudly.
        throw new Error(`verifier procedure failed on ${fixture.id}/${intentId}: ${result.error.message}`);
      }
      const verdict = result.value;
      if (verdict.decision === "reject") anyReject = true;
      rationales.push(verdict.aggregate_rationale, ...verdict.per_triple.map((t) => t.rationale));
      for (const t of verdict.per_triple) {
        if (t.evidence.focal_claim) focalClaims.push({ file: t.evidence.focal_claim.file, lines: t.evidence.focal_claim.lines });
      }
    }

    return {
      decision: anyReject ? "reject" : "accept",
      rationale: rationales.filter((r) => r.length > 0).join(" "),
      evidence: { focal_claims: focalClaims },
      usage: { latency_ms: latencyMs, cost_usd: costUsd },
    };
  };
}
