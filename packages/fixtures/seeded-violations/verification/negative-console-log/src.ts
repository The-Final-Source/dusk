// @intent logging/no-console [no-console]
export function recordEvent(name: string): void {
  // @intent logging/no-console [no-console]
  console.log("event: " + name); // SEEDED: verification/negative-console-log
}
