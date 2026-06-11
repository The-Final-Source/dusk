// @intent input/validate-at-boundary [validates-input]
export function handleRequest(payload: { name?: unknown }): string {
  // @intent input/validate-at-boundary [validates-input]
  const name = payload.name as string; // SEEDED: verification/no-input-validation
  // @intent input/validate-at-boundary [validates-input]
  return store(name);
}

function store(name: string): string {
  return "stored-" + name;
}
