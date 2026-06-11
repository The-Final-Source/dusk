// @intent sync/no-dry-run-events [no-dry-run-events]
export function dryRun(rows: string[]): number {
  // @intent sync/no-dry-run-events [no-dry-run-events]
  const planned = rows.length;
  // @intent sync/no-dry-run-events [no-dry-run-events]
  publish("dry-run-summary"); // SEEDED: verification/quantifier-none-violated
  // @intent sync/no-dry-run-events [no-dry-run-events]
  return planned;
}

function publish(_channel: string): void {}
