// @intent api/write-endpoint [marks-write]
// @intent api/idempotency-on-writes [validates-idempotency, stores-idempotency]
export function createWidget(payload: { name: string }, idempotencyKey: string): string {
  // @intent api/idempotency-on-writes [validates-idempotency]
  if (idempotencyKey.length === 0) throw new Error("missing Idempotency-Key");
  // @intent api/idempotency-on-writes [stores-idempotency]
  const stored = storeKey(idempotencyKey.toLowerCase()); // SEEDED: verification/calibration-controversial-case-insensitive-key
  // @intent api/write-endpoint [marks-write]
  return persist(payload.name, stored);
}

function storeKey(key: string): string {
  return key;
}

function persist(name: string, _key: string): string {
  return "widget-" + name;
}
