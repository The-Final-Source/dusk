import { z } from "zod";

/**
 * The per-file `<filename.ext>.intent` sidecar body (D.28; design D2/D3). JSON,
 * Zod as source of truth. Claims and ignore entries anchor by JSON Pointer (RFC
 * 6901; `""` = whole document) — never line numbers (line spans are derived every
 * run). Markers reuse the inline `DecorationMarker` set; ignore entries reuse the
 * `@intent-ignore` because/reason vocabulary.
 */

const DECORATION_MARKERS = ["intent", "intent-support", "intent-test", "intent-test-file", "intent-file", "intent-ignore"] as const;

export const SidecarClaimSchema = z
  .object({
    anchor: z.string(),
    marker: z.enum(DECORATION_MARKERS),
    intent_path: z.string().min(1),
    // Omit to claim the whole intent; an EMPTY array claims nothing and is a
    // silent under-coverage trap (D.31/G12) — require ≥1 when the key is present.
    aspect_ids: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

export const SidecarIgnoreSchema = z
  .object({
    anchor: z.string(),
    because: z.tuple([z.string(), z.string(), z.string()]),
    reason: z.string().min(1),
  })
  .strict();

export const SidecarBodySchema = z
  .object({
    schema_version: z.literal(1),
    target: z.string().min(1),
    claims: z.array(SidecarClaimSchema).default([]),
    ignore: z.array(SidecarIgnoreSchema).default([]),
  })
  .strict();

export type SidecarClaim = z.infer<typeof SidecarClaimSchema>;
export type SidecarIgnore = z.infer<typeof SidecarIgnoreSchema>;
export type SidecarBody = z.infer<typeof SidecarBodySchema>;
