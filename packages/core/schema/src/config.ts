import { z } from "zod";

export const DEFAULT_TEST_PYRAMID_SUFFIXES = ["unit-tests", "integration-tests", "e2e-tests"] as const;

/**
 * `dusk.config.yml`. Phase 1 only reads `intents.dir` and `test_pyramid.suffixes`;
 * other sections (sanity / models / test_runner) pass through untouched.
 */
export const DuskConfigSchema = z
  .object({
    version: z.number().default(1),
    intents: z
      .object({ dir: z.string().default(".ia/intents") })
      .partial()
      .default({ dir: ".ia/intents" }),
    test_pyramid: z
      .object({ suffixes: z.array(z.string().min(1)).default([...DEFAULT_TEST_PYRAMID_SUFFIXES]) })
      .default({ suffixes: [...DEFAULT_TEST_PYRAMID_SUFFIXES] }),
    // Phase 2 additions (additive; the outer file shape is unchanged).
    models: z
      .object({ default: z.string().optional(), overrides: z.record(z.string()).optional() })
      .partial()
      .optional(),
    verifier_evidence_max_lines: z.number().int().positive().optional(),
    // D.28 (universal-decoration-coverage): the single ignore SSoT. Project
    // additions merge with built-in defaults (see `loadIgnoreGlobs` in
    // @dusk/core-decoration); replaces the three hardcoded `SKIP_DIRS`.
    decoration: z
      .object({ ignore: z.array(z.string().min(1)).default([]) })
      .partial()
      .optional(),
    // Phase 5 addition (additive; defaults preserve current behavior).
    observability: z
      .object({
        trace_ring_bytes: z.number().int().positive().optional(),
        mirrors: z
          .array(z.object({ sink: z.enum(["otlp", "posthog"]), endpoint: z.string().min(1) }).strict())
          .optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

export type DuskConfig = z.infer<typeof DuskConfigSchema>;

export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const DEFAULT_VERIFIER_EVIDENCE_MAX_LINES = 200;

export function defaultModel(config: DuskConfig): string {
  return config.models?.default ?? DEFAULT_MODEL;
}

export function modelForRole(config: DuskConfig, role: string): string {
  return config.models?.overrides?.[role] ?? defaultModel(config);
}

export function verifierEvidenceMaxLines(config: DuskConfig): number {
  return config.verifier_evidence_max_lines ?? DEFAULT_VERIFIER_EVIDENCE_MAX_LINES;
}

export function intentsDir(config: DuskConfig): string {
  return config.intents?.dir ?? ".ia/intents";
}

export function testPyramidSuffixes(config: DuskConfig): string[] {
  return config.test_pyramid?.suffixes ?? [...DEFAULT_TEST_PYRAMID_SUFFIXES];
}

export const DEFAULT_TRACE_RING_BYTES = 64 * 1024 * 1024;

export type MirrorConfig = { sink: "otlp" | "posthog"; endpoint: string };

export function traceRingBytes(config: DuskConfig): number {
  return config.observability?.trace_ring_bytes ?? DEFAULT_TRACE_RING_BYTES;
}

export function traceMirrors(config: DuskConfig): MirrorConfig[] {
  return config.observability?.mirrors ?? [];
}
