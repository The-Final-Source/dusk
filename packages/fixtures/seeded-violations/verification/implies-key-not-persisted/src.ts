// @intent api/write-endpoint [marks-write]
// @intent api/idempotency-on-writes [validates-idempotency, stores-idempotency]
export function createWidget(payload: { name: string }, idempotencyKey: string): string {
  // @intent api/idempotency-on-writes [validates-idempotency]
  if (idempotencyKey.length === 0) throw new Error("missing Idempotency-Key");
  // @intent api/idempotency-on-writes [stores-idempotency]
  persistWidget(payload.name); // SEEDED: verification/implies-key-not-persisted
  // @intent api/write-endpoint [marks-write]
  return "widget-" + payload.name;
}

function persistWidget(name: string): void {
  void name;
}
