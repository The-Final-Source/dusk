import { z } from "zod";

import { PolaritySchema } from "./primitives.js";

/**
 * Verifier output shape — RFC App. A.4. The split verdict is load-bearing:
 * `focal_verdict` drives Engineer re-draft (Phase 3); `support_quality` is a
 * diagnostic-only signal that NEVER, by itself, fails a focal claim.
 */

export const FOCAL_VERDICTS = ["pass", "fail"] as const;
export const FocalVerdictSchema = z.enum(FOCAL_VERDICTS);
export type FocalVerdict = z.infer<typeof FocalVerdictSchema>;

export const SUPPORT_QUALITIES = ["ok", "low_confidence"] as const;
export const SupportQualitySchema = z.enum(SUPPORT_QUALITIES);
export type SupportQuality = z.infer<typeof SupportQualitySchema>;

/** Per-support-claim verdict: matches | mismatch | vague (LLM-extracted, §3.3). */
export const TRIPLE_VERDICTS = ["matches", "mismatch", "vague"] as const;
export const TripleVerdictSchema = z.enum(TRIPLE_VERDICTS);
export type TripleVerdict = z.infer<typeof TripleVerdictSchema>;

export const VERDICT_DECISIONS = ["accept", "reject"] as const;
export const VerdictDecisionSchema = z.enum(VERDICT_DECISIONS);
export type VerdictDecision = z.infer<typeof VerdictDecisionSchema>;

const LineRangeSchema = z.tuple([z.number().int(), z.number().int()]);
const SupportTripleSchema = z.tuple([z.string(), z.string(), z.string()]);

export const FocalClaimSchema = z
  .object({ file: z.string(), lines: LineRangeSchema, quote: z.string() })
  .strict();
export type FocalClaim = z.infer<typeof FocalClaimSchema>;

export const SupportClaimVerdictSchema = z
  .object({
    file: z.string(),
    lines: LineRangeSchema,
    quote: z.string(),
    support_triple: SupportTripleSchema,
    triple_verdict: TripleVerdictSchema,
  })
  .strict();
export type SupportClaimVerdict = z.infer<typeof SupportClaimVerdictSchema>;

export const TripleEvidenceSchema = z
  .object({
    /** The primary focal claimant (first decoration of the aspect) — unchanged shape. */
    focal_claim: FocalClaimSchema.optional(),
    /**
     * ALL focal claimants of the aspect (additive, v1.x). When an aspect is
     * decorated on more than one line, `focal_claim` is only the first; the
     * audit's citation-precision scorer (RFC §7.5.1) needs every claimant so a
     * defect on a later claimant is still citable. Present when the verifier
     * had ≥1 focal claimant; `focal_claim === focal_claims[0]`.
     */
    focal_claims: z.array(FocalClaimSchema).optional(),
    support_claims: z.array(SupportClaimVerdictSchema).default([]),
    /** Count of passing supports summarized rather than enumerated (default verbosity). */
    support_pass_count: z.number().int().optional(),
  })
  .strict();
export type TripleEvidence = z.infer<typeof TripleEvidenceSchema>;

export const PerTripleVerdictSchema = z
  .object({
    triple_id: z.string(),
    focal_verdict: FocalVerdictSchema,
    support_quality: SupportQualitySchema,
    /** Original polarity preserved for post-hoc inversion attribution (Phase 5 audit). */
    polarity: PolaritySchema,
    evidence: TripleEvidenceSchema,
    rationale: z.string(),
  })
  .strict();
export type PerTripleVerdict = z.infer<typeof PerTripleVerdictSchema>;

export const VerdictSchema = z
  .object({
    intent_path: z.string(),
    decision: VerdictDecisionSchema,
    /** Present only for `compose: implies`. If false, `per_triple` is empty. */
    implies_antecedent_held: z.boolean().optional(),
    per_triple: z.array(PerTripleVerdictSchema),
    aggregate_rationale: z.string(),
  })
  .strict();
export type Verdict = z.infer<typeof VerdictSchema>;
