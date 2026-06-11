// @intent demo/beta [do-beta]
export function betaEntry(): string {
  // @intent demo/beta [do-beta]
  const tail = gammaTail(); // SEEDED: static-analysis/erosion-gamma-chain
  // @intent demo/beta [do-beta]
  return tail;
}

// @intent demo/gamma [do-gamma]
function gammaTail(): string {
  return "gamma";
}
