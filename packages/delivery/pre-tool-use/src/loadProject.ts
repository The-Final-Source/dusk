import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { parse as parseYaml } from "yaml";
import { DuskConfigSchema, intentsDir, testPyramidSuffixes, type DuskConfig } from "@dusk/core-schema";
import { buildIntentGraph, loadIntentTree, type IntentGraph } from "@dusk/core-graph";

export type ProjectContext = {
  root: string;
  config: DuskConfig;
  graph: IntentGraph;
  suffixes: string[];
  supersededBy: Map<string, string>;
};

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function findProjectRoot(fromPath: string): string | null {
  let dir = isDirectory(fromPath) ? fromPath : dirname(fromPath);
  for (;;) {
    if (existsSync(join(dir, "dusk.config.yml")) || existsSync(join(dir, ".ia"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadProject(fromPath: string): ProjectContext | null {
  const root = findProjectRoot(fromPath);
  if (!root) return null;

  let config = DuskConfigSchema.parse({});
  const configPath = join(root, "dusk.config.yml");
  if (existsSync(configPath)) {
    try {
      config = DuskConfigSchema.parse(parseYaml(readFileSync(configPath, "utf8")) ?? {});
    } catch {
      // fall back to defaults on a malformed config
    }
  }

  const tree = loadIntentTree(join(root, intentsDir(config)));
  const graph = buildIntentGraph(tree.intents);
  const supersededBy = new Map<string, string>();
  for (const [id, intent] of tree.intents) {
    for (const edge of intent.relates_to) {
      if (edge.kind === "supersedes") supersededBy.set(edge.target, id);
    }
  }
  return { root, config, graph, suffixes: testPyramidSuffixes(config), supersededBy };
}
