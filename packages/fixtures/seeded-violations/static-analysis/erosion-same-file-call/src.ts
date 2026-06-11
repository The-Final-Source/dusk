// @intent demo/alpha [do-alpha]
export function caller(): string {
  // @intent demo/alpha [do-alpha]
  const result = helper(); // SEEDED: static-analysis/erosion-same-file-call
  // @intent demo/alpha [do-alpha]
  return result;
}

// @intent demo/beta [do-beta]
function helper(): string {
  return "beta";
}
