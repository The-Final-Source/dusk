// @intent notifications/cleanup-stale-devices [cleanup-stale]
export function handleDeliveryError(token: string, code: string): boolean {
  // @intent notifications/cleanup-stale-devices [cleanup-stale]
  if (code === "deviceNotRegistered") {
    queueForDeletion(token); // SEEDED: verification/calibration-controversial-batched-cleanup
  }
  // @intent notifications/cleanup-stale-devices [cleanup-stale]
  return true;
}

function queueForDeletion(_token: string): void {}
