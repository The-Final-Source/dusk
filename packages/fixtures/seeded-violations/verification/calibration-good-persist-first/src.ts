// @intent notifications/persist-first [persist-first]
export function send(payload: string): string {
  // @intent notifications/persist-first [persist-first]
  const rowId = insert(payload);
  // @intent notifications/persist-first [persist-first]
  publish(rowId);
  // @intent notifications/persist-first [persist-first]
  return rowId;
}

function insert(p: string): string {
  return "row-" + p;
}

function publish(_rowId: string): void {}
