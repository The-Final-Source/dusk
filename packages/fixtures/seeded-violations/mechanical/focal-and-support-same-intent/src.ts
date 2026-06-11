// @intent demo/feature [do-thing]
export function runFeature(): string {
  // @intent demo/feature [log-thing]
  // @intent-support demo/feature [log-thing] ["the logger", "writes", "a payload"] // SEEDED: mechanical/focal-and-support-same-intent
  emit();
  // @intent demo/feature [do-thing]
  return "demo";
}

function emit(): void {}
