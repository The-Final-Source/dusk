/**
 * Injectable clock. Product code that reads time MUST take a Clock rather than
 * calling Date.now() directly, so TTL/GC/drain behavior (later phases) is
 * deterministic under test. Established here as the project-wide convention.
 */
export type Clock = { now: () => number };

export const systemClock: Clock = { now: () => Date.now() };

export function fixedClock(epochMs: number): Clock {
  return { now: () => epochMs };
}

/** A clock the test can advance manually. */
export function manualClock(startMs = 0): Clock & { advance: (ms: number) => void; set: (ms: number) => void } {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    set: (ms: number) => {
      current = ms;
    },
  };
}
