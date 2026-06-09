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
  })
  .passthrough();

export type DuskConfig = z.infer<typeof DuskConfigSchema>;

export function intentsDir(config: DuskConfig): string {
  return config.intents?.dir ?? ".ia/intents";
}

export function testPyramidSuffixes(config: DuskConfig): string[] {
  return config.test_pyramid?.suffixes ?? [...DEFAULT_TEST_PYRAMID_SUFFIXES];
}
