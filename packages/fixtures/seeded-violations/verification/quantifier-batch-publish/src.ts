// @intent sync/event-per-insert [one-event-per-insert]
export function publishInserted(rows: string[]): number {
  // @intent sync/event-per-insert [one-event-per-insert]
  const count = publish("batch", rows.length); // SEEDED: verification/quantifier-batch-publish
  // @intent sync/event-per-insert [one-event-per-insert]
  return count;
}

function publish(_channel: string, n: number): number {
  return n > 0 ? 1 : 0;
}
