import { duskError, err, ok, type DuskConfig, type RuntimeResult } from "@dusk/core-schema";

/**
 * The two short-cycle budgets (RFC §6.4; design D12; 6.1). Read from
 * `dusk.config.yml > sanity.*`; tests assert the RELATIONSHIP (lifetime >
 * per-entry), not the literal 20/40 defaults. The relationship is enforced at
 * config-load time so a misconfiguration surfaces explicitly (no silent
 * behavior).
 */

export const DEFAULT_PER_ENTRY_MAX = 20;
export const DEFAULT_LIFETIME_MAX = 40;

export type ShortCycleBudgets = { perEntryMax: number; lifetimeMax: number };

export function readBudgets(config: DuskConfig): RuntimeResult<ShortCycleBudgets> {
  const sanity = ((config as Record<string, unknown>).sanity ?? {}) as Record<string, unknown>;
  const perEntryMax = typeof sanity.short_cycle_max_iterations === "number" ? sanity.short_cycle_max_iterations : DEFAULT_PER_ENTRY_MAX;
  const lifetimeMax = typeof sanity.bead_lifetime_iterations === "number" ? sanity.bead_lifetime_iterations : DEFAULT_LIFETIME_MAX;
  if (!(lifetimeMax > perEntryMax)) {
    return err(
      duskError(
        "config_invalid",
        `sanity.bead_lifetime_iterations (${lifetimeMax}) must exceed sanity.short_cycle_max_iterations (${perEntryMax})`,
        { recoverable: false, details: { perEntryMax, lifetimeMax } },
      ),
    );
  }
  return ok({ perEntryMax, lifetimeMax });
}
