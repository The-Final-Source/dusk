// @intent notifications/cleanup-stale-devices [cleanup-stale]
export function handleDeliveryError(token: string, code: string): boolean {
  // @intent notifications/cleanup-stale-devices [cleanup-stale]
  if (code === "deviceNotRegistered") {
    log({ stale: token }); // SEEDED: verification/cleanup-only-logs
  }
  // @intent notifications/cleanup-stale-devices [cleanup-stale]
  return true;
}

function log(_payload: Record<string, string>): void {}
