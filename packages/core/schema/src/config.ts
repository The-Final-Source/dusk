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
