import { loadIntentTree } from "@dusk/core-graph";

import { findFieldLine, intentsDirOf, loadConfig } from "./project.js";

export type ValidationFailure = { file: string; line: number; message: string };
export type ValidationResult = { ok: boolean; count: number; failures: ValidationFailure[] };

type Issue = { message: string; path?: string };

/** Validate all intents under the project's intents dir; report each defect with file:line. */
export function validateIntents(root: string): ValidationResult {
  const config = loadConfig(root);
  const tree = loadIntentTree(intentsDirOf(root, config));
  const failures: ValidationFailure[] = [];
  for (const failure of tree.failures) {
    for (const issue of failure.errors as Issue[]) {
      const line = issue.path ? findFieldLine(failure.file, issue.path) : 1;
      const where = issue.path ? ` (${issue.path})` : "";
      failures.push({ file: failure.file, line, message: `${failure.id}: ${issue.message}${where}` });
    }
  }
  return { ok: failures.length === 0, count: tree.intents.size, failures };
}
