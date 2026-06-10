import type { DerivedIndex } from "@dusk/core-index";
import {
  duskError,
  isDuskError,
  type Intent,
  type PerTripleVerdict,
  type RuntimeResult,
  type Triple,
  type TripleVerdict,
  type Verdict,
  type VerdictDecision,
  type VerifierFactory,
  type FocalVerdict,
} from "@dusk/core-schema";

import { evaluateAntecedent, resolveUnit, type UnitUnderEvaluation } from "./antecedent.js";
import { aggregateDecision } from "./composeAgg.js";
import { assembleEvidence, type ReadFile } from "./evidence.js";
import { type ModelClient, type ModelUsage, parseModelResponse } from "./modelClient.js";
import { focalVerdictFromAffirmative } from "./polarity.js";
import { buildVerifierUserPrompt, supportId, type TripleToJudge } from "./prompt.js";
import { aggregateSupportQuality } from "./supportQuality.js";

export const DEFAULT_VERIFIER_SYSTEM_PROMPT =
  "You are a Dusk Verifier. Judge each affirmative claim against the scoped evidence; never invert for " +
  "polarity (the runtime does that). Answer only with the requested JSON.";

export type VerifyDeps = {
  index: DerivedIndex;
  readFile: ReadFile;
  maxLines: number;
  systemPrompt?: string;
  /** Real model path (verdict-correctness). */
  modelClient?: ModelClient;
  /** Control-flow substitution returning a whole Verdict (the scripted double). */
  verifierFactory?: VerifierFactory;
  sessionId?: string;
  /** Explicit unit-under-evaluation for the antecedent (else resolved from the index). */
  unit?: UnitUnderEvaluation;
  onUsage?: (usage: ModelUsage) => void;
};

const triplesOf = (intent: Intent): Triple[] =>
  intent.compose === "implies" ? (intent.consequent ?? []) : (intent.triples ?? []);

function vacuousAccept(intent: Intent): Verdict {
  return {
    intent_path: intent.id,
    decision: "accept",
    implies_antecedent_held: false,
    per_triple: [],
    aggregate_rationale: "antecedent did not hold; consequent not required",
  };
}

function aggregateRationale(decision: VerdictDecision, compose: string, focalVerdicts: FocalVerdict[]): string {
  const fails = focalVerdicts.filter((v) => v === "fail").length;
  return `${decision} under compose:${compose} — ${fails}/${focalVerdicts.length} focal verdicts failed`;
}

/**
 * The §3.3 Verifier procedure for one intent (Plan P2-T5–T18). Deterministic
 * antecedent gate first (no model call when an `implies` antecedent is false),
 * then either the injected control-flow factory or the real model path:
 * scoped evidence → affirmative prompt → model verdict → runtime polarity
 * inversion → per-support `triple_verdict` → `support_quality` → `compose`
 * aggregation → App. A.4 Verdict.
 */
export async function verifyIntent(intent: Intent, deps: VerifyDeps): Promise<RuntimeResult<Verdict>> {
  let antecedentHeld: boolean | undefined;

  if (intent.compose === "implies") {
    const unit = deps.unit
      ? { success: true as const, value: deps.unit }
      : resolveUnit(intent.id, deps.index);
    if (!unit.success) return unit;
    antecedentHeld = evaluateAntecedent(intent, unit.value, deps.index).held;
    if (!antecedentHeld) return { success: true, value: vacuousAccept(intent) };
  }

  const triples = triplesOf(intent);

  // Assemble scoped evidence per triple (bounded; overflow is a structural error).
  const toJudge: TripleToJudge[] = [];
  for (const triple of triples) {
    const evidence = assembleEvidence(intent.id, triple.id, deps.index, deps.readFile, deps.maxLines);
    if (!evidence.success) return evidence;
    toJudge.push({ triple, focal: evidence.value.focal, support: evidence.value.support });
  }

  // Control-flow path: delegate the whole verdict to the injected factory (the double).
  if (deps.verifierFactory) {
    const result = await deps.verifierFactory({
      intentPath: intent.id,
      sessionId: deps.sessionId ?? "",
      assembledPrompt: buildVerifierUserPrompt(intent, toJudge),
    });
    if (isDuskError(result)) return { success: false, error: result };
    const verdict = intent.compose === "implies" ? { ...result, implies_antecedent_held: antecedentHeld } : result;
    return { success: true, value: verdict };
  }

  if (!deps.modelClient) {
    return { success: false, error: duskError("internal_error", "verifyIntent requires a modelClient or verifierFactory", { recoverable: false }) };
  }

  const userPrompt = buildVerifierUserPrompt(intent, toJudge);
  const completion = await deps.modelClient.complete({
    system: deps.systemPrompt ?? DEFAULT_VERIFIER_SYSTEM_PROMPT,
    user: userPrompt,
    temperature: 0,
  });
  deps.onUsage?.(completion.usage);

  const parsed = parseModelResponse(completion.text);
  if (!parsed) {
    return { success: false, error: duskError("verifier_model_call_failed", "model response was not parseable JSON", { recoverable: true }) };
  }

  const perTriple: PerTripleVerdict[] = [];
  const focalVerdicts: FocalVerdict[] = [];
  for (const { triple, focal, support } of toJudge) {
    const answer = parsed.triples.find((t) => t.triple_id === triple.id);
    const affirmativeHolds = answer?.affirmative_holds ?? false;
    const focalVerdict = focalVerdictFromAffirmative(affirmativeHolds, triple.polarity);
    focalVerdicts.push(focalVerdict);

    const supportVerdicts: TripleVerdict[] = [];
    const failedSupports: PerTripleVerdict["evidence"]["support_claims"] = [];
    let passCount = 0;
    support.forEach((s, i) => {
      const sid = supportId(triple.id, i);
      const verdict = answer?.supports.find((x) => x.id === sid)?.triple_verdict ?? "vague";
      supportVerdicts.push(verdict);
      if (verdict === "matches") passCount += 1;
      else failedSupports.push({ file: s.file, lines: s.lines, quote: s.quote, support_triple: s.support_triple, triple_verdict: verdict });
    });

    perTriple.push({
      triple_id: triple.id,
      focal_verdict: focalVerdict,
      support_quality: aggregateSupportQuality(supportVerdicts),
      polarity: triple.polarity,
      evidence: {
        ...(focal[0] ? { focal_claim: { file: focal[0].file, lines: focal[0].lines, quote: focal[0].quote } } : {}),
        support_claims: failedSupports,
        ...(passCount > 0 ? { support_pass_count: passCount } : {}),
      },
      rationale: answer?.rationale ?? "",
    });
  }

  const decision = aggregateDecision(intent.compose, focalVerdicts, { antecedentHeld });
  return {
    success: true,
    value: {
      intent_path: intent.id,
      decision,
      ...(intent.compose === "implies" ? { implies_antecedent_held: antecedentHeld } : {}),
      per_triple: perTriple,
      aggregate_rationale: aggregateRationale(decision, intent.compose, focalVerdicts),
    },
  };
}

/** Real model-backed `VerifierFactory` for spawnSubAgent (Phase 3 plugs this in). */
export function realVerifierFactory(deps: {
  resolveIntent: (path: string) => Intent | undefined;
  index: DerivedIndex;
  readFile: ReadFile;
  maxLines: number;
  modelClient: ModelClient;
  systemPrompt?: string;
}): VerifierFactory {
  return async (ctx) => {
    const intent = deps.resolveIntent(ctx.intentPath);
    if (!intent) {
      return duskError("intent_path_unresolved", `intent not found: ${ctx.intentPath}`, { recoverable: true });
    }
    const result = await verifyIntent(intent, {
      index: deps.index,
      readFile: deps.readFile,
      maxLines: deps.maxLines,
      modelClient: deps.modelClient,
      systemPrompt: deps.systemPrompt,
      sessionId: ctx.sessionId,
      onUsage: ctx.reportUsage,
    });
    return result.success ? result.value : result.error;
  };
}
