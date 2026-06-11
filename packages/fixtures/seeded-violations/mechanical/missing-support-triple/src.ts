// @intent demo/feature [do-thing]
export function runFeature(): string {
  // @intent-support demo/feature [log-thing] // SEEDED: mechanical/missing-support-triple
  const payload = build();
  // @intent demo/feature [do-thing]
  return payload;
}

function build(): string {
  return "demo";
}
