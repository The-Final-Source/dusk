import { z } from "zod";

import { MappingProvenanceSchema } from "./enums.js";

const sha256Hex = /^[a-f0-9]{64}$/;

export const SourceMapFileSchema = z.object({
  path: z.string().min(1),
  confidence: z.number().min(0).max(1),
  provenance: MappingProvenanceSchema,
  last_confirmed: z.string().datetime().optional(),
});

export const SourceMapEntrySchema = z.object({
  constraint: z.string().min(1),
  files: z.array(SourceMapFileSchema),
  unmapped: z.array(z.string()).optional(),
});

export const SourceMapSchema = z.object({
  intent: z.string().min(1),
  intent_hash: z.string().regex(sha256Hex, "intent_hash must be a 64-character hex SHA-256"),
  synced_at: z.string().datetime(),
  stale: z.boolean().default(false),
  mappings: z.array(SourceMapEntrySchema),
});

export type SourceMapFile = z.infer<typeof SourceMapFileSchema>;
export type SourceMapEntry = z.infer<typeof SourceMapEntrySchema>;
export type SourceMap = z.infer<typeof SourceMapSchema>;
