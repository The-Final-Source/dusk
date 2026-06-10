/**
 * The single place that reads `process.env`. Everything else receives a
 * `RuntimeEnv` by injection (coding guideline: config via injection).
 *
 * `spawnMode` gates the test/benchmark-only `raw_prompt` capture (design D2):
 * production traces NEVER serialize the assembled prompt.
 */

export const SPAWN_MODES = ["production", "test", "benchmark"] as const;
export type SpawnMode = (typeof SPAWN_MODES)[number];

export type RuntimeEnv = {
  spawnMode: SpawnMode;
  /** Present when an Anthropic key is configured; consumed only by the real model client. */
  anthropicApiKey?: string;
};

const isSpawnMode = (value: string | undefined): value is SpawnMode =>
  value !== undefined && (SPAWN_MODES as readonly string[]).includes(value);

/** Read the runtime env once, from the process (or an injected source for tests). */
export function readRuntimeEnv(source: Record<string, string | undefined> = process.env): RuntimeEnv {
  return {
    spawnMode: isSpawnMode(source.DUSK_SPAWN_MODE) ? source.DUSK_SPAWN_MODE : "production",
    anthropicApiKey: source.ANTHROPIC_API_KEY,
  };
}

/** Whether the assembled prompt is captured to `raw_prompt` on traces. */
export const capturesRawPrompt = (env: RuntimeEnv): boolean => env.spawnMode !== "production";

/** Startup banner line — logged so a mis-deployed non-production mode is visible. */
export const startupBanner = (env: RuntimeEnv): string => `dusk runtime · spawnMode=${env.spawnMode}`;

/**
 * Pipeline operations (Phase 3) are refused outside production mode. The guard
 * ships now; `dusk doctor` and the Phase-3 pipeline both consult it.
 */
export function pipelineGuard(env: RuntimeEnv): { allowed: boolean; reason?: string } {
  if (env.spawnMode !== "production") {
    return { allowed: false, reason: `pipeline operations require spawnMode=production (current: ${env.spawnMode})` };
  }
  return { allowed: true };
}
