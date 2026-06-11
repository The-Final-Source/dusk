// @intent demo/alpha [do-alpha]
export function caller(): string {
  // @intent demo/alpha [do-alpha]
  const result = dualHelper(); // SEEDED: static-analysis/erosion-partial-overlap
  // @intent demo/alpha [do-alpha]
  return result;
}

// @intent demo/alpha [do-alpha]
// @intent demo/beta [do-beta]
function dualHelper(): string {
  return "alpha+beta";
}
