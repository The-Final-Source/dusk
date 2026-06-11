// @intent api/write-endpoint [marks-write]
// @intent api/idempotency-on-writes [validates-idempotency, stores-idempotency]
export function createWidget(payload: { name: string }, idempotencyKey: string): string {
  // @intent api/idempotency-on-writes [validates-idempotency]
  if (idempotencyKey.length === 0) throw new Error("missing Idempotency-Key");
  // @intent api/idempotency-on-writes [stores-idempotency]
  const widgetId = persist(payload.name); // SEEDED: verification/implies-key-not-persisted
  // @intent api/write-endpoint [marks-write]
  return widgetId;
}

function persist(name: string): string {
  return "widget-" + name;
}
