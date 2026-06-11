// @intent demo/alpha [do-alpha]
export function caller(): string {
  // @intent demo/alpha [do-alpha]
  const first = helper(); // SEEDED: static-analysis/erosion-repeated-call
  // @intent demo/alpha [do-alpha]
  const second = helper();
  // @intent demo/alpha [do-alpha]
  return first + second;
}

// @intent demo/beta [do-beta]
function helper(): string {
  return "beta";
}
