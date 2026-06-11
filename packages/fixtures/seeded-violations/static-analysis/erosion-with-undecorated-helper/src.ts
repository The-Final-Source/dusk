// @intent demo/alpha [do-alpha]
export function caller(): string {
  // @intent demo/alpha [do-alpha]
  const noise = plainHelper();
  // @intent demo/alpha [do-alpha]
  const result = betaHelper(noise); // SEEDED: static-analysis/erosion-with-undecorated-helper
  // @intent demo/alpha [do-alpha]
  return result;
}

function plainHelper(): string {
  return "plain";
}

// @intent demo/beta [do-beta]
function betaHelper(prefix: string): string {
  return prefix + "beta";
}
