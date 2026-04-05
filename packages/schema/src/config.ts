import { z } from "zod";

// Simple semver validation
const semverRegex = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/;

export const HooksConfigSchema = z
  .object({
    pre: z.record(z.string()).optional(),
    post: z.record(z.string()).optional(),
  })
  .optional();

export const VerificationConfigSchema = z
  .object({
    model_diversity: z.boolean().optional(),
    max_rounds: z.number().int().positive().optional(),
    confidence_threshold: z.number().min(0).max(1).optional(),
  })
  .optional();

export const StorageConfigSchema = z
  .object({
    cache: z.string().optional(),
    adherence: z.string().optional(),
  })
  .optional();

export const IntentConfigSchema = z.object({
  version: z.string().regex(semverRegex, "version must be valid semver"),
  blocks: z.string(),
  intents_dir: z.string().default(".ia/intents"),
  scope_root: z.string().default("."),
  hooks: HooksConfigSchema,
  verification: VerificationConfigSchema,
  storage: StorageConfigSchema,
});

export type IntentConfig = z.infer<typeof IntentConfigSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;
export type VerificationConfig = z.infer<typeof VerificationConfigSchema>;
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
