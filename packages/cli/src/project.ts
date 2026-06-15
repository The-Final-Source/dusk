import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { DuskConfigSchema, intentsDir, type DuskConfig } from "@dusk/core-schema";
import { loadIgnoreGlobs, scanDecorations as sharedScanDecorations, type DecorationRecord } from "@dusk/core-decoration";

export function loadConfig(root: string): DuskConfig {
  const path = join(root, "dusk.config.yml");
  if (!existsSync(path)) return DuskConfigSchema.parse({});
  try {
    return DuskConfigSchema.parse(parseYaml(readFileSync(path, "utf8")) ?? {});
  } catch {
    return DuskConfigSchema.parse({});
  }
}

export function intentsDirOf(root: string, config: DuskConfig): string {
  return join(root, intentsDir(config));
}

/**
 * Scan a project's decorations (for inspect / doctor) via the single shared
 * `.intent`-aware scanner (keystone, design D1) — so directory `.intent` and
 * per-file sidecar records are visible here too, and the `decoration.ignore`
 * SSoT replaces the former hardcoded `SKIP_DIRS` (board M2).
 */
export function scanDecorations(root: string): DecorationRecord[] {
  return sharedScanDecorations(root, { ignore: loadIgnoreGlobs(loadConfig(root)) });
}

/** Best-effort line of a field within a YAML file (for file:line reporting). */
export function findFieldLine(file: string, fieldPath: string): number {
  if (!fieldPath || !existsSync(file)) return 1;
  const last = fieldPath.split(".").pop() ?? fieldPath;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^\\s*(- )?${last}:`).test(line));
  return index >= 0 ? index + 1 : 1;
}
