// @intent demo/feature [do-thing]
export function runFeature(): string {
  // @intent-support demo/feature [log-thing] ["", "constructs", "the payload"] // SEEDED: mechanical/malformed-support-triple-empty
  const payload = build();
  // @intent demo/feature [do-thing]
  return payload;
}

function build(): string {
  return "demo";
}
