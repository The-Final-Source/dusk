// @intent demo/feature [do-thing]
export function runFeature(): string {
  // @intent demo/feature [do-thing]
  const value = compute();
  return value; // SEEDED: mechanical/missing-statement-decorator
}

function compute(): string {
  return "demo";
}
