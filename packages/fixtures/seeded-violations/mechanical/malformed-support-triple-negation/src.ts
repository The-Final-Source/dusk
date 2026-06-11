// @intent demo/feature [do-thing]
export function runFeature(): string {
  // @intent-support demo/feature [log-thing] ["the builder", "never constructs", "raw sql"] // SEEDED: mechanical/malformed-support-triple-negation
  const payload = build();
  // @intent demo/feature [do-thing]
  return payload;
}

function build(): string {
  return "demo";
}
