import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import type { Intent } from "@dusk/core-schema";
import { readIntentFile } from "@dusk/core-parser";

export type IntentLoadFailure = { id: string; file: string; errors: unknown[] };
export type IntentTreeLoad = {
  intents: Map<string, Intent>;
  failures: IntentLoadFailure[];
  warnings: Array<{ id: string; messages: string[] }>;
};

function findIntentFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === "intent.yaml") out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * Walk `.ia/intents/` recursively, loading every `intent.yaml` and resolving its id from
 * the directory path. The path-to-id rule is enforced (a mismatch becomes a failure).
 */
export function loadIntentTree(intentsDir: string): IntentTreeLoad {
  const intents = new Map<string, Intent>();
  const failures: IntentLoadFailure[] = [];
  const warnings: Array<{ id: string; messages: string[] }> = [];
  if (!existsSync(intentsDir)) return { intents, failures, warnings };

  for (const file of findIntentFiles(intentsDir)) {
    const id = relative(intentsDir, dirname(file)).split(sep).join("/");
    const load = readIntentFile(file, id);
    if (load.success) {
      intents.set(id, load.intent);
      if (load.warnings.length > 0) warnings.push({ id, messages: load.warnings });
    } else {
      failures.push({ id, file, errors: load.errors });
    }
  }
  return { intents, failures, warnings };
}
