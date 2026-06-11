// @intent observability/structured-payloads [structured-payloads]
export function logDelivery(userId: string, status: string): void {
  // @intent observability/structured-payloads [structured-payloads]
  log({ userId, status }, "delivery complete");
}

function log(_payload: Record<string, string>, _message: string): void {}
