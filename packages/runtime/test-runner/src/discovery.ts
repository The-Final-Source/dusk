import type { DerivedIndex } from "@dusk/core-index";

/**
 * Test-file discovery (RFC §3.4; 9.4). Test files are found via the derived
 * index's `@intent-test` / `@intent-test-file` claims for a test-intent, and (for
 * pyramid-layer discovery) via the configurable `test_pyramid.suffixes`. Each
 * claim carries the test-intent path + the `covers-*` triples it covers.
 */

export type TestClaim = {
  file: string;
  line: number;
  testIntentPath: string;
  /** The `covers-*` triple ids this claim covers (the decoration aspect_ids). */
  coveredTriples: string[];
};

export function discoverTestClaims(index: DerivedIndex, testIntentPath: string): TestClaim[] {
  return index.testDiscovery(testIntentPath).map((r) => ({
    file: r.file,
    line: r.line,
    testIntentPath: r.intent_path,
    coveredTriples: r.aspect_ids ?? [],
  }));
}

/** Distinct test files for a test-intent. */
export const testFilesFor = (index: DerivedIndex, testIntentPath: string): string[] =>
  [...new Set(discoverTestClaims(index, testIntentPath).map((c) => c.file))];

/** All `covers-*` triples a test-intent's claims cover. */
export const coveredTriplesFor = (index: DerivedIndex, testIntentPath: string): string[] =>
  [...new Set(discoverTestClaims(index, testIntentPath).flatMap((c) => c.coveredTriples))];

/** Pyramid-layer discovery (9.4): parent intent + configured suffixes → claims per suffix. */
export function discoverByLayer(index: DerivedIndex, parentPath: string, suffixes: string[]): Record<string, TestClaim[]> {
  const out: Record<string, TestClaim[]> = {};
  for (const suffix of suffixes) {
    const childPath = `${parentPath}/${suffix}`;
    const claims = discoverTestClaims(index, childPath);
    if (claims.length > 0) out[suffix] = claims;
  }
  return out;
}
