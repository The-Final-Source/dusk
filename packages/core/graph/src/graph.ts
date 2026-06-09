import type { Intent, RelatesToKind } from "@dusk/core-schema";

export type IntentGraph = {
  intents: Map<string, Intent>;
  has: (id: string) => boolean;
  get: (id: string) => Intent | undefined;
  /** Existing ancestor ids: explicit `kind: parent` edges first, then path-segment parents. Nearest first. */
  ancestors: (id: string) => string[];
  /** Existing descendant ids (everything under `id/`). */
  descendants: (id: string) => string[];
  /** Targets of `relates_to` edges of a given kind. */
  relatedBy: (id: string, kind: RelatesToKind) => string[];
  /** Existing test-pyramid children `id/<suffix>` for the configured suffixes. */
  testPyramidChildren: (id: string, suffixes: string[]) => string[];
};

function pathAncestors(id: string): string[] {
  const segments = id.split("/");
  const out: string[] = [];
  for (let i = segments.length - 1; i >= 1; i -= 1) out.push(segments.slice(0, i).join("/"));
  return out;
}

export function buildIntentGraph(intents: Map<string, Intent>): IntentGraph {
  const ancestors = (id: string): string[] => {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const edge of intents.get(id)?.relates_to ?? []) {
      if (edge.kind === "parent" && intents.has(edge.target) && !seen.has(edge.target)) {
        seen.add(edge.target);
        result.push(edge.target);
      }
    }
    for (const ancestor of pathAncestors(id)) {
      if (intents.has(ancestor) && !seen.has(ancestor)) {
        seen.add(ancestor);
        result.push(ancestor);
      }
    }
    return result;
  };
  const descendants = (id: string): string[] => {
    const prefix = `${id}/`;
    return [...intents.keys()].filter((key) => key.startsWith(prefix)).sort();
  };
  const relatedBy = (id: string, kind: RelatesToKind): string[] =>
    (intents.get(id)?.relates_to ?? []).filter((edge) => edge.kind === kind).map((edge) => edge.target);
  const testPyramidChildren = (id: string, suffixes: string[]): string[] =>
    suffixes.map((suffix) => `${id}/${suffix}`).filter((childId) => intents.has(childId));

  return {
    intents,
    has: (id) => intents.has(id),
    get: (id) => intents.get(id),
    ancestors,
    descendants,
    relatedBy,
    testPyramidChildren,
  };
}

export type CycleReport = { hasCycle: boolean; cycles: string[][] };

/** Detect cycles over `relates_to` edges of ANY kind (targets that resolve to known intents). */
export function detectRelatesToCycles(intents: Map<string, Intent>): CycleReport {
  const adjacency = new Map<string, string[]>();
  for (const [id, intent] of intents) {
    adjacency.set(
      id,
      (intent.relates_to ?? []).map((edge) => edge.target).filter((target) => intents.has(target)),
    );
  }
  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const status = state.get(next) ?? 0;
      if (status === 0) visit(next);
      else if (status === 1) cycles.push(stack.slice(stack.indexOf(next)));
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const id of intents.keys()) {
    if ((state.get(id) ?? 0) === 0) visit(id);
  }
  return { hasCycle: cycles.length > 0, cycles };
}
