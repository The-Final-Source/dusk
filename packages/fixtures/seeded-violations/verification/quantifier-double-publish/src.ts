// @intent sync/event-per-insert [one-event-per-insert]
export function publishInserted(rows: string[]): number {
  // @intent sync/event-per-insert [one-event-per-insert]
  let count = 0;
  // @intent sync/event-per-insert [one-event-per-insert]
  for (const row of rows) {
    count += publish(row);
    // @intent sync/event-per-insert [one-event-per-insert]
    count += publish(row); // SEEDED: verification/quantifier-double-publish
  }
  // @intent sync/event-per-insert [one-event-per-insert]
  return count;
}

function publish(_row: string): number {
  return 1;
}
