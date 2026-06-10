/**
 * Cooperative cancellation flag (RFC §10.1.2; design D9; 12.1). Claude Code's
 * Task tool has no abort primitive, so cancel is flag-and-drain: `dusk_cancel`
 * sets a per-bead (or session-wide) flag; the orchestrator's tick reads it AFTER
 * the current Task call returns and issues NO new Task calls for the flagged
 * target. In-flight Task calls run to completion (counted as
 * `in_flight_tasks_drained`).
 */

const SESSION = "__session__";
const flags = new Map<string, string>(); // scope → reason

export function setCancelFlag(reason: string, beadId?: string): void {
  flags.set(beadId ?? SESSION, reason);
}

/** A bead is cancelled if its own flag is set OR a session-wide flag is set. */
export function isCancelled(beadId: string): boolean {
  return flags.has(beadId) || flags.has(SESSION);
}

export function cancelReason(beadId: string): string | undefined {
  return flags.get(beadId) ?? flags.get(SESSION);
}

export function clearCancelFlags(): void {
  flags.clear();
}
