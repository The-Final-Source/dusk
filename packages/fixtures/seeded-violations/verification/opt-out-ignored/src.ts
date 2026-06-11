// @intent notifications/respect-opt-out [respect-opt-out]
export function pushAll(users: Array<{ id: string; pushOptOut: boolean }>): number {
  // @intent notifications/respect-opt-out [respect-opt-out]
  let sent = 0;
  // @intent notifications/respect-opt-out [respect-opt-out]
  for (const user of users) {
    // @intent notifications/respect-opt-out [respect-opt-out]
    sent += push(user.id); // SEEDED: verification/opt-out-ignored
  }
  // @intent notifications/respect-opt-out [respect-opt-out]
  return sent;
}

function push(_id: string): number {
  return 1;
}
