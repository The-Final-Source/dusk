import { z } from "zod";

import {
  AntecedentTripleSchema,
  ComposeRuleSchema,
  ObligationSchema,
  RelatesToSchema,
  TripleSchema,
} from "./primitives.js";

/** Slash-namespaced intent path, e.g. `api/pagination/cursor-only/cursor-decode`. */
export const INTENT_ID_PATTERN = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/;

export const IntentSchema = z
  .object({
    schema_version: z.literal(2).default(2),
    id: z.string().regex(INTENT_ID_PATTERN, "id must be a slash-namespaced path of lowercase segments"),
    description: z.string().min(1),
    obligation: ObligationSchema,
    compose: ComposeRuleSchema.default("all"),
    triples: z.array(TripleSchema).optional(),
    antecedent: z.array(AntecedentTripleSchema).optional(),
    consequent: z.array(TripleSchema).optional(),
    relates_to: z.array(RelatesToSchema).default([]),
  })
  .strict()
  .superRefine((intent, ctx) => {
    if (intent.compose === "implies") {
      if (!intent.antecedent || intent.antecedent.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["antecedent"], message: "compose: implies requires a non-empty antecedent group" });
      }
      if (!intent.consequent || intent.consequent.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["consequent"], message: "compose: implies requires a non-empty consequent group" });
      }
      if (intent.triples) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["triples"], message: "compose: implies uses antecedent/consequent, not triples" });
      }
    } else {
      if (!intent.triples || intent.triples.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["triples"], message: `compose: ${intent.compose} requires a non-empty triples list` });
      }
      if (intent.antecedent || intent.consequent) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["compose"], message: "antecedent/consequent are only valid with compose: implies" });
      }
    }
    // Triple ids must be unique within the intent (across all groups present).
    const ids = [...(intent.triples ?? []), ...(intent.antecedent ?? []), ...(intent.consequent ?? [])].map((t) => t.id);
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["triples"], message: `duplicate triple id "${id}"` });
      }
      seen.add(id);
    }
  });

export type Intent = z.infer<typeof IntentSchema>;
