// @intent api/write-endpoint [marks-write]
// @intent api/idempotency-on-writes [validates-idempotency, stores-idempotency]
export function createWidget(payload: { name: string }): string {
  // @intent api/idempotency-on-writes [validates-idempotency]
  const widgetId = persist(payload.name); // SEEDED: verification/implies-no-idempotency-validation
  // @intent api/idempotency-on-writes [stores-idempotency]
  return widgetId;
}

function persist(name: string): string {
  return "widget-" + name;
}
