// @intent demo/alpha [do-alpha]
export function caller(): string {
  // @intent demo/alpha [do-alpha]
  const result = compute(); // SEEDED: static-analysis/erosion-arrow-callee
  // @intent demo/alpha [do-alpha]
  return result;
}

// @intent demo/beta [do-beta]
const compute = (): string => "beta";
