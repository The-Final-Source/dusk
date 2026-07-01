import { PocReportSchema, type PocExploratory, type PocReport, type StaticAnalysisReport } from "@dusk/core-schema";

import { auditTrailers, type AuditInput, type TrailerAuditResult } from "./trailerAudit.js";
import { checkProvenance, type CheckProvenanceInput, type ProvenanceResult } from "./provenanceCheck.js";

/**
 * Phase-6 §6.1/§6.2 — the `PocReport` evaluator (design D9; spec `poc-report`).
 * A ZERO-MODEL, DETERMINISTIC, re-runnable pure pass that consumes a POC's
 * `git log` + `traces.jsonl` + `dusk doctor --static-analysis` output (through
 * the §5.1–5.3 primitives) and emits a `PocReport`.
 *
 * The gating section carries EXACTLY the six POC hard gates (each pass/fail) +
 * a top-level `pass`; the exploratory section is labeled `gating: false` and
 * carries friction data that NEVER affects the verdict (the no-blended-metrics
 * rule, enforced structurally by `PocGatingSchema.strict()` + the literal-false
 * exploratory tag). The output parses against `PocReportSchema`.
 *
 * Re-running over identical inputs yields a byte-identical report: the pass sorts
 * its derived collections and reads no clock except the caller-supplied
 * `evaluated_at`/`initialized_at`, so determinism is the caller's to preserve by
 * passing fixed window timestamps.
 */

export type PocEvaluatorInput = {
  /** The standalone POC repo this report evaluates (path or name). */
  poc_repo: string;
  window: { initialized_at: string; evaluated_at: string };

  // ---- Gating inputs (via the §5.1–5.3 primitives + doctor output). ----
  /** Parsed `git log` + human actions for the trailer audit (§5.2). */
  trailerAudit: AuditInput;
  /** Parsed intents + author-trace ids + finalize ids for the provenance check (§5.3). */
  provenance: CheckProvenanceInput;
  /** Endpoints that did NOT land via `dusk_implement` with a mergeable commit. */
  endpointsNotPipelineLanded: number;
  /** Gate false-positive count on the POC (a legitimate write the gate wrongly blocked). */
  gateFalsePositiveCount: number;
  /** The full pyramid (unit + integration vs live Postgres + e2e vs real HTTP) state. */
  fullPyramidOnLiveInfra: "green" | "red";
  /** Both `dusk doctor` runs — conservative AND `--strict-unknowns`. Clean ⇔ zero findings in both. */
  staticAnalysis: { conservative: StaticAnalysisReport; strictUnknowns: StaticAnalysisReport };

  // ---- Exploratory inputs (never gated). ----
  exploratory: Omit<PocExploratory, "gating">;
};

export type PocEvaluation = {
  report: PocReport;
  /** The intermediate primitive results, surfaced for diagnostics (not persisted). */
  audit: TrailerAuditResult;
  provenance: ProvenanceResult;
};

/** Static analysis is clean when BOTH modes report zero findings. */
function staticAnalysisState(input: PocEvaluatorInput): "clean" | "eroded" {
  const clean = input.staticAnalysis.conservative.findings.length === 0 && input.staticAnalysis.strictUnknowns.findings.length === 0;
  return clean ? "clean" : "eroded";
}

/**
 * Evaluate a POC into a `PocReport`. Deterministic + zero-model: the same input
 * yields the same output. Emits a report that parses against `PocReportSchema`.
 */
export function evaluatePoc(input: PocEvaluatorInput): PocEvaluation {
  const audit = auditTrailers(input.trailerAudit);
  const provenance = checkProvenance(input.provenance);

  const handwrittenCount = audit.handwritten_application_commit_count;
  const intentsNotAuthored = provenance.violations.filter(
    (v) => v.kind === "orphaned_intent_no_author_trace" || v.kind === "orphaned_intent_no_finalize_record",
  ).length;
  const staticState = staticAnalysisState(input);

  const gating: PocReport["gating"] = {
    handwritten_application_commit_count: { value: handwrittenCount, threshold: "== 0", pass: handwrittenCount === 0 },
    endpoints_not_pipeline_landed: {
      value: input.endpointsNotPipelineLanded,
      threshold: "== 0",
      pass: input.endpointsNotPipelineLanded === 0,
    },
    gate_false_positive_count: { value: input.gateFalsePositiveCount, threshold: "== 0", pass: input.gateFalsePositiveCount === 0 },
    intents_not_dialog_authored: { value: intentsNotAuthored, threshold: "== 0", pass: intentsNotAuthored === 0 },
    full_pyramid_on_live_infra: {
      value: input.fullPyramidOnLiveInfra,
      threshold: "green",
      pass: input.fullPyramidOnLiveInfra === "green",
    },
    static_analysis_both_modes: { value: staticState, threshold: "clean", pass: staticState === "clean" },
    pass: false,
  };
  gating.pass =
    gating.handwritten_application_commit_count.pass &&
    gating.endpoints_not_pipeline_landed.pass &&
    gating.gate_false_positive_count.pass &&
    gating.intents_not_dialog_authored.pass &&
    gating.full_pyramid_on_live_infra.pass &&
    gating.static_analysis_both_modes.pass;

  const report: PocReport = {
    schema_version: 1,
    poc_repo: input.poc_repo,
    window: { initialized_at: input.window.initialized_at, evaluated_at: input.window.evaluated_at },
    gating,
    exploratory: { gating: false, ...input.exploratory },
  };

  return { report: PocReportSchema.parse(report), audit, provenance };
}
