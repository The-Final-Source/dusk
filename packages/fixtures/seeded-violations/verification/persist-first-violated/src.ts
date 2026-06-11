// @intent notifications/persist-first [persist-first]
export function send(payload: string): string {
  // @intent notifications/persist-first [persist-first]
  publish(payload); // SEEDED: verification/persist-first-violated
  // @intent notifications/persist-first [persist-first]
  const rowId = insert(payload);
  // @intent notifications/persist-first [persist-first]
  return rowId;
}

function publish(_p: string): void {}

function insert(p: string): string {
  return "row-" + p;
}
