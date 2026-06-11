import { listBeta } from "./util.js";

// @intent demo/alpha [do-alpha]
export function collect(): string[] {
  // @intent demo/alpha [do-alpha]
  const rows = listBeta(); // SEEDED: static-analysis/erosion-cross-file-two-hops
  // @intent demo/alpha [do-alpha]
  return rows;
}
