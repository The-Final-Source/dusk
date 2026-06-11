// @intent error-handling/catch-log-continue [catch-log-continue]
export function deliver(payload: string): string {
  // @intent error-handling/catch-log-continue [catch-log-continue]
  try {
    push(payload);
  } catch (error) {
    logDebug({ error: String(error) }); // SEEDED: verification/calibration-controversial-debug-level
  }
  // @intent error-handling/catch-log-continue [catch-log-continue]
  return "delivered";
}

function push(_p: string): void {}

function logDebug(_payload: Record<string, string>): void {}
