import { z } from "zod";

import { ConstraintSchema } from "./constraint.js";
import { RelatesToSchema } from "./block.js";

export const IntentDecisionSchema = z.object({
  point: z.string().min(1),
  choice: z.string().min(1),
  rationale: z.string().optional(),
});

export const IntentSchema = z
  .object({
    id: z.string().min(1),
    scope: z.string().min(1),
    adopts: z.array(z.string().min(1)),
    decisions: z.array(IntentDecisionSchema).optional().default([]),
    relates_to: z.array(RelatesToSchema).optional().default([]),
    constraints: z.array(ConstraintSchema).optional().default([]),
  })
  .refine(
    (intent) => {
      const ids = intent.constraints.map((c) => c.id);
      return new Set(ids).size === ids.length;
    },
    {
      message: "Constraint IDs must be unique within an intent",
      path: ["constraints"],
    },
  );

export type IntentDecision = z.infer<typeof IntentDecisionSchema>;
export type Intent = z.infer<typeof IntentSchema>;
