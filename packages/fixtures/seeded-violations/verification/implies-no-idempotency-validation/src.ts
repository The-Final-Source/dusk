// @intent api/write-endpoint [marks-write]
// @intent api/idempotency-on-writes [validates-idempotency, stores-idempotency]
export function createWidget(payload: { name: string }): string {
  // @intent api/idempotency-on-writes [validates-idempotency]
  persistWidget(payload.name); // SEEDED: verification/implies-no-idempotency-validation
  // @intent api/write-endpoint [marks-write]
  return "widget-" + payload.name;
}

function persistWidget(name: string): void {
  void name;
}
