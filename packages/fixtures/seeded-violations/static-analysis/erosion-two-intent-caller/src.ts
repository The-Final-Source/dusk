// @intent demo/alpha [do-alpha]
// @intent demo/gamma [do-gamma]
export function caller(): string {
  // @intent demo/alpha [do-alpha]
  const result = helper(); // SEEDED: static-analysis/erosion-two-intent-caller
  // @intent demo/gamma [do-gamma]
  return result;
}

// @intent demo/beta [do-beta]
function helper(): string {
  return "beta";
}
