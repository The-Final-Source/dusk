// @intent api/write-endpoint [marks-write]
// @intent api/idempotency-on-writes [validates-idempotency, stores-idempotency]
export function createWidget(payload: { name: string }, idempotencyKey: string): string {
  // @intent api/idempotency-on-writes [validates-idempotency]
  if (idempotencyKey.length === 0) throw new Error("missing Idempotency-Key");
  // @intent api/idempotency-on-writes [stores-idempotency]
  storeKey(idempotencyKey.toLowerCase()); // SEEDED: verification/calibration-controversial-case-insensitive-key
  // @intent api/write-endpoint [marks-write]
  return "widget-" + payload.name;
}

function storeKey(_key: string): void {}
