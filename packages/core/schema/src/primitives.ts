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
