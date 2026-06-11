import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";
import { parseDecorations } from "@dusk/core-decoration";
import { analyzeStaticDecoration, buildDerivedIndex } from "@dusk/core-index";
import { loadIntentTree } from "@dusk/core-graph";
import { IntentSchema, type Intent } from "@dusk/core-schema";

/**
 * Registry services — Phase 5 ecosystem skeleton (design D9; P5-T14 api half).
 * Canonical-intent search/download over `packages/intents/canonical/` and
 * on-demand hierarchical adherence from the derived index — NO adherence DB
 * (satisfaction is computed from the index per the v9 architecture).
 * Routable/renderable, not feature-complete: no pagination, no editing.
 */

export type RegistryRoots = {
  repoRoot?: string;
  canonicalDir?: string;
  intentsDir?: string;
};

const defaultRepoRoot = (): string => fileURLToPath(new URL("../../../../..", import.meta.url));

const resolveRoots = (roots: RegistryRoots = {}) => {
  const repoRoot = roots.repoRoot ?? defaultRepoRoot();
  return {
    repoRoot,
    canonicalDir: roots.canonicalDir ?? join(repoRoot, "packages/intents/canonical"),
    intentsDir: roots.intentsDir ?? join(repoRoot, ".ia/intents"),
  };
};

export type CanonicalIntentSummary = {
  path: string;
  description: string;
  obligation: string;
};

function walkIntentFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "intent.yaml") out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/** Name/description substring search over the canonical intent library. */
export function searchCanonicalIntents(query: string, roots: RegistryRoots = {}): CanonicalIntentSummary[] {
  const { canonicalDir } = resolveRoots(roots);
  const needle = query.toLowerCase();
  const results: CanonicalIntentSummary[] = [];
  for (const file of walkIntentFiles(canonicalDir)) {
    const parsed = IntentSchema.safeParse(parseYaml(readFileSync(file, "utf8")));
    if (!parsed.success) continue;
    const { id, description, obligation } = parsed.data;
    if (needle.length > 0 && !id.toLowerCase().includes(needle) && !description.toLowerCase().includes(needle)) continue;
    results.push({ path: id, description, obligation });
  }
  return results;
}

/** One canonical intent's parsed content by path. */
export function getCanonicalIntent(path: string, roots: RegistryRoots = {}): Intent | null {
  const { canonicalDir } = resolveRoots(roots);
  const file = join(canonicalDir, path, "intent.yaml");
  if (!existsSync(file) || relative(canonicalDir, file).startsWith("..")) return null;
  const parsed = IntentSchema.safeParse(parseYaml(readFileSync(file, "utf8")));
  return parsed.success ? parsed.data : null;
}

export type AdherenceIntentEntry = {
  path: string;
  description: string;
  obligation: string;
  total_aspects: number;
  unsatisfied_aspects: string[];
  satisfied: boolean;
  claimed_in_package: boolean;
};

export type AdherenceSummary = {
  package: string;
  intents: AdherenceIntentEntry[];
  coverage: Array<{ file: string; decorated_units: number; undecorated_units: number }>;
};

const SOURCE_EXT = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", "build", "coverage", ".git"]);

function collectPackageSources(repoRoot: string, packagePath: string): Record<string, string> {
  const files: Record<string, string> = {};
  const start = join(repoRoot, packagePath);
  if (!existsSync(start)) return files;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full);
        continue;
      }
      const dot = entry.lastIndexOf(".");
      if (dot === -1 || !SOURCE_EXT.has(entry.slice(dot)) || entry.endsWith(".d.ts")) continue;
      files[relative(repoRoot, full)] = readFileSync(full, "utf8");
    }
  };
  walk(start);
  return files;
}

/** Hierarchical satisfaction for a named decorated package, computed on demand from the derived index. */
export function getAdherenceSummary(packagePath: string, roots: RegistryRoots = {}): AdherenceSummary {
  const { repoRoot, intentsDir } = resolveRoots(roots);
  const files = collectPackageSources(repoRoot, packagePath);
  const tree = loadIntentTree(intentsDir);
  const records = Object.entries(files).flatMap(([file, source]) => parseDecorations(source, file));
  const index = buildDerivedIndex(records, tree.intents);

  const claimed = new Set(records.map((r) => r.intent_path));
  const intents: AdherenceIntentEntry[] = [...tree.intents.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((intent) => {
      const aspects = intent.compose === "implies" ? (intent.consequent ?? []) : (intent.triples ?? []);
      const unsatisfied = index.aspectRollup(intent.id);
      return {
        path: intent.id,
        description: intent.description,
        obligation: intent.obligation,
        total_aspects: aspects.length,
        unsatisfied_aspects: unsatisfied,
        satisfied: unsatisfied.length === 0,
        claimed_in_package: claimed.has(intent.id),
      };
    });

  const { density_baseline } = analyzeStaticDecoration({ files, index, mode: "conservative" });
  return {
    package: packagePath,
    intents,
    coverage: density_baseline.map((d) => ({ file: d.file, decorated_units: d.decorated_units, undecorated_units: d.undecorated_units })),
  };
}
