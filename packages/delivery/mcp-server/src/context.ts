import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { loadIgnoreGlobs, scanDecorations } from "@dusk/core-decoration";
import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import { loadIntentTree } from "@dusk/core-graph";
import { DuskConfigSchema, intentsDir, type DuskConfig, type Intent, type Verdict } from "@dusk/core-schema";
import type { ModelClient } from "@dusk/runtime-verifier";

/**
 * The read-only context every MCP tool/resource shares (design D10): one loaded
 * derived index, one read function. The `verdictStore` holds the most-recent
 * verdict per intent so `dusk_inspect` can surface low-confidence supports (D11).
 */
export type DuskContext = {
  rootDir: string;
  config: DuskConfig;
  index: DerivedIndex;
  intents: Map<string, Intent>;
  readFile: (file: string) => string;
  modelClient?: ModelClient;
  systemPrompt?: string;
  verdictStore: Map<string, Verdict>;
};

// The decoration walker is now the single shared `.intent`-aware scanner in
// `@dusk/core-decoration` (keystone, design D1) — re-exported so existing callers
// are unchanged. It dispatches inline / directory `.intent` / per-file sidecar and
// consults the `decoration.ignore` SSoT (no private `SKIP_DIRS`/`SOURCE_EXT`).
export { scanDecorations } from "@dusk/core-decoration";

export type BuildContextParams = {
  rootDir: string;
  config?: DuskConfig;
  index: DerivedIndex;
  intents: Map<string, Intent>;
  readFile: (file: string) => string;
  modelClient?: ModelClient;
  systemPrompt?: string;
};

/** Build a context from an already-assembled index (used by the worked-example fixtures). */
export function buildContext(params: BuildContextParams): DuskContext {
  return {
    rootDir: params.rootDir,
    config: params.config ?? DuskConfigSchema.parse({}),
    index: params.index,
    intents: params.intents,
    readFile: params.readFile,
    modelClient: params.modelClient,
    systemPrompt: params.systemPrompt,
    verdictStore: new Map(),
  };
}

/** Load a project's context from disk: config + intents + scanned decorations. */
export function loadProjectContext(rootDir: string, opts: Partial<Pick<DuskContext, "modelClient" | "systemPrompt">> = {}): DuskContext {
  let config = DuskConfigSchema.parse({});
  const configPath = join(rootDir, "dusk.config.yml");
  if (existsSync(configPath)) {
    try {
      config = DuskConfigSchema.parse(parseYaml(readFileSync(configPath, "utf8")) ?? {});
    } catch {
      // fall back to defaults on a malformed config
    }
  }
  const tree = loadIntentTree(join(rootDir, intentsDir(config)));
  const records = scanDecorations(rootDir, { ignore: loadIgnoreGlobs(config) });
  const index = buildDerivedIndex(records, tree.intents);
  const readFile = (file: string): string => {
    const full = join(rootDir, file);
    return existsSync(full) ? readFileSync(full, "utf8") : "";
  };
  return { rootDir, config, index, intents: tree.intents, readFile, verdictStore: new Map(), ...opts };
}
