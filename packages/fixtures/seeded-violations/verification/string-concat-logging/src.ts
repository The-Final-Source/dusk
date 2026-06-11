// @intent observability/structured-payloads [structured-payloads]
export function logDelivery(userId: string, status: string): void {
  // @intent observability/structured-payloads [structured-payloads]
  log("delivered to " + userId + " with status " + status); // SEEDED: verification/string-concat-logging
}

function log(_message: string): void {}
