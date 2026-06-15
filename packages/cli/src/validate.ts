import { join } from "node:path";

import { loadIntentTree } from "@dusk/core-graph";
import { validateVerifyChannel } from "@dusk/core-parser";

import { findFieldLine, intentsDirOf, loadConfig } from "./project.js";

export type ValidationFailure = { file: string; line: number; message: string };
export type ValidationResult = { ok: boolean; count: number; failures: ValidationFailure[] };

type Issue = { message: string; path?: string };

/** Validate all intents under the project's intents dir; report each defect with file:line. */
export function validateIntents(root: string): ValidationResult {
  const config = loadConfig(root);
  const intentsDir = intentsDirOf(root, config);
  const tree = loadIntentTree(intentsDir);
  const failures: ValidationFailure[] = [];
  for (const failure of tree.failures) {
    for (const issue of failure.errors as Issue[]) {
      const line = issue.path ? findFieldLine(failure.file, issue.path) : 1;
      const where = issue.path ? ` (${issue.path})` : "";
      failures.push({ file: failure.file, line, message: `${failure.id}: ${issue.message}${where}` });
    }
  }
  // Verification-channel honesty (RFC App. D.31) — over every successfully-loaded
  // intent's triples (the same primitive the Author runs at Stage 4.5).
  for (const [id, intent] of tree.intents) {
    const file = join(intentsDir, id, "intent.yaml");
    for (const triple of [...(intent.triples ?? []), ...(intent.consequent ?? [])]) {
      for (const v of validateVerifyChannel(triple)) {
        failures.push({ file, line: findFieldLine(file, v.path), message: `${id}: ${v.message}` });
      }
    }
  }
  return { ok: failures.length === 0, count: tree.intents.size, failures };
}
