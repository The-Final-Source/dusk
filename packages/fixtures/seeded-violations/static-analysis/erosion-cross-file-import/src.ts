import { remoteHelper } from "./util.js";

// @intent demo/alpha [do-alpha]
export function caller(): string {
  // @intent demo/alpha [do-alpha]
  const result = remoteHelper(); // SEEDED: static-analysis/erosion-cross-file-import
  // @intent demo/alpha [do-alpha]
  return result;
}
