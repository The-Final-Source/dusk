// @intent error-handling/catch-log-continue [catch-log-continue]
export function deliver(payload: string): string {
  // @intent error-handling/catch-log-continue [catch-log-continue]
  try {
    push(payload);
  } catch (error) {
    throw error; // SEEDED: verification/catch-log-rethrow
  }
  // @intent error-handling/catch-log-continue [catch-log-continue]
  return "delivered";
}

function push(_p: string): void {}
