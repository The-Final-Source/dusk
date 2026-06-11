// @intent demo/alpha [do-alpha]
export function caller(flag: boolean): string {
  // @intent demo/alpha [do-alpha]
  if (flag) {
    return betaPath(); // SEEDED: static-analysis/erosion-nested-call
  }
  // @intent demo/alpha [do-alpha]
  return "alpha";
}

// @intent demo/beta [do-beta]
function betaPath(): string {
  return "beta";
}
