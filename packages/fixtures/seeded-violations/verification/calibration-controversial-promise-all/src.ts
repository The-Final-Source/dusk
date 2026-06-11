// @intent notifications/persist-first [persist-first]
export async function send(payload: string): Promise<string> {
  // @intent notifications/persist-first [persist-first]
  const [rowId] = await Promise.all([insert(payload), publish(payload)]); // SEEDED: verification/calibration-controversial-promise-all
  // @intent notifications/persist-first [persist-first]
  return rowId;
}

async function insert(p: string): Promise<string> {
  return "row-" + p;
}

async function publish(_p: string): Promise<void> {}
