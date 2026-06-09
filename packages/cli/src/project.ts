import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { DuskConfigSchema, intentsDir, type DuskConfig } from "@dusk/core-schema";
import { parseDecorations, type DecorationRecord } from "@dusk/core-decoration";

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

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".ia", ".claude"]);

/** Scan a project's TypeScript for decoration records (for inspect / doctor). */
export function scanDecorations(root: string): DecorationRecord[] {
  const records: DecorationRecord[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        records.push(...parseDecorations(readFileSync(join(dir, entry.name), "utf8"), join(dir, entry.name)));
      }
    }
  };
  walk(root);
  return records;
}

/** Best-effort line of a field within a YAML file (for file:line reporting). */
export function findFieldLine(file: string, fieldPath: string): number {
  if (!fieldPath || !existsSync(file)) return 1;
  const last = fieldPath.split(".").pop() ?? fieldPath;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^\\s*(- )?${last}:`).test(line));
  return index >= 0 ? index + 1 : 1;
}
