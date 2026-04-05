import { z } from "zod";

import { ObligationSchema, VerifiabilitySchema } from "./enums.js";

// Single-sentence validation: reject if text contains multiple sentences
// A sentence boundary is a period/exclamation/question mark followed by a space and uppercase letter
const singleSentence = (val: string) => {
  // Allow the text to end with a period, but reject multiple sentences
  // A sentence boundary is punctuation followed by space and uppercase letter,
  // but NOT when the period follows a single lowercase letter (abbreviations like "e.g.")
  const sentenceBreaks = val.match(/(?<![a-z])[.!?]\s+[A-Z]/g);
  return !sentenceBreaks;
};

export const ConstraintSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).refine(singleSentence, {
    message: "Constraint text must be a single sentence",
  }),
  obligation: ObligationSchema,
  negative: z.boolean().default(false),
  verifiability: VerifiabilitySchema.optional(),
  concern_hint: z.string().optional(),
  refs: z.array(z.string()).optional(),
});

export type Constraint = z.infer<typeof ConstraintSchema>;
