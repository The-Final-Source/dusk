import { z } from "zod";

export const OBLIGATIONS = ["must", "should", "may"] as const;
export const ObligationSchema = z.enum(OBLIGATIONS);
export type Obligation = z.infer<typeof ObligationSchema>;

export const COMPOSE_RULES = ["all", "any", "none", "implies"] as const;
export const ComposeRuleSchema = z.enum(COMPOSE_RULES);
export type ComposeRule = z.infer<typeof ComposeRuleSchema>;

export const POLARITIES = ["positive", "negative"] as const;
export const PolaritySchema = z.enum(POLARITIES);
export type Polarity = z.infer<typeof PolaritySchema>;

/**
 * Verification channel of a triple (RFC App. D.30). `structural` = verified
 * MECHANICALLY (its claimant's anchor resolves + the target is decoration-
 * covered), zero LLM; `semantic` = judged by the LLM Verifier. This is a
 * property of the CLAIM (is there behavior to judge?), declared by the AUTHOR —
 * NOT derived from how the file is decorated (D.29 derived it from modality,
 * which forced comment-bearing config onto the semantic channel where it cannot
 * converge). Absent ≡ falls back to decoration modality (sidecar→structural,
 * inline→semantic), preserving every existing intent; an explicit value is
 * authoritative. Authored, version-controlled, set before any code or model
 * call — so the Engineer cannot downgrade its own claim to escape a verdict.
 */
export const VERIFY_CHANNELS = ["structural", "semantic"] as const;
export const VerifyChannelSchema = z.enum(VERIFY_CHANNELS);
export type VerifyChannel = z.infer<typeof VerifyChannelSchema>;

export const FIXED_QUANTIFIERS = ["at-least-one", "each", "exactly-one", "at-most-one", "none"] as const;
/** Quantifier vocabulary: the fixed set plus the parameterized `at-least-<N>` / `at-most-<N>` forms. */
export const QuantifierSchema = z
  .string()
  .refine(
    (value) => (FIXED_QUANTIFIERS as readonly string[]).includes(value) || /^at-(least|most)-\d+$/.test(value),
    { message: "invalid quantifier (expected at-least-one|each|exactly-one|at-most-one|none|at-least-<N>|at-most-<N>)" },
  );
export type Quantifier = z.infer<typeof QuantifierSchema>;

/** Closed antecedent predicate vocabulary for `compose: implies` (deterministic index lookup, never LLM-judged). */
export const ANTECEDENT_PREDICATES = [
  "is decorated with",
  "claims any aspect of",
  "is enclosed by a decoration of",
] as const;
export const AntecedentPredicateSchema = z.enum(ANTECEDENT_PREDICATES);
export type AntecedentPredicate = z.infer<typeof AntecedentPredicateSchema>;

export const RELATES_TO_KINDS = ["parent", "implies", "conflicts", "supersedes", "sibling"] as const;
export const RelatesToKindSchema = z.enum(RELATES_TO_KINDS);
export type RelatesToKind = z.infer<typeof RelatesToKindSchema>;

/** A normal triple: affirmative slots; structural negation via `polarity`. */
export const TripleSchema = z
  .object({
    id: z.string().min(1),
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
    polarity: PolaritySchema.default("positive"),
    quantifier: QuantifierSchema.optional(),
    scope: z.string().min(1).optional(),
    /** Author-declared verification channel (RFC App. D.30). Absent ≡ derive from decoration modality. */
    verify: VerifyChannelSchema.optional(),
  })
  .strict();
export type Triple = z.infer<typeof TripleSchema>;

/** An antecedent triple: predicate restricted to the closed vocabulary; object is a resolvable reference. */
export const AntecedentTripleSchema = z
  .object({
    id: z.string().min(1),
    subject: z.string().min(1),
    predicate: AntecedentPredicateSchema,
    object: z.string().min(1),
    polarity: PolaritySchema.default("positive"),
  })
  .strict();
export type AntecedentTriple = z.infer<typeof AntecedentTripleSchema>;

export const RelatesToSchema = z
  .object({
    kind: RelatesToKindSchema,
    target: z.string().min(1),
  })
  .strict();
export type RelatesTo = z.infer<typeof RelatesToSchema>;
