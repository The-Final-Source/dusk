import type { Intent } from "@dusk/core-schema";
import { loadIntentTree } from "@dusk/core-graph";
import { buildDerivedIndex } from "@dusk/core-index";

import { intentsDirOf, loadConfig, scanDecorations } from "./project.js";

export type InspectResult = {
  intent: Intent;
  descendants: string[];
  testChildren: string[];
  unsatisfiedTestChildren: string[];
  aspectsUnclaimed: string[];
};

/** Pretty-print data for one intent: its shape, descendants, test-pyramid children, and structural gaps. */
export function inspectIntent(root: string, intentPath: string): InspectResult | null {
  const config = loadConfig(root);
  const tree = loadIntentTree(intentsDirOf(root, config));
  const intent = tree.intents.get(intentPath);
  if (!intent) return null;

  const index = buildDerivedIndex(scanDecorations(root), tree.intents);
  const suffixes = config.test_pyramid?.suffixes ?? [];
  const testChildren = index.graph.testPyramidChildren(intentPath, suffixes);

  // Structural satisfaction: an aspect is "satisfied" iff it has a focal claimant (Phase 1 proxy).
  const isAspectClaimed = (id: string, aspect: string): boolean => !index.aspectRollup(id).includes(aspect);
  const unsatisfiedTestChildren = testChildren.filter((child) => !index.isSatisfied(child, isAspectClaimed).satisfied);

  return {
    intent,
    descendants: index.graph.descendants(intentPath),
    testChildren,
    unsatisfiedTestChildren,
    aspectsUnclaimed: index.aspectRollup(intentPath),
  };
}
