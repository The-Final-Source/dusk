import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SubAgentTraceSchema, tracePath, type SubAgentRole, type SubAgentTrace } from "@dusk/core-schema";

/**
 * Default observability trace path relative to a project root — derived from the
 * `@dusk/core-schema` layout SSoT (`tracePath("")`) so this in-test reader can
 * never drift from the path the ring-buffer writer produces.
 */
export const TRACES_RELATIVE_PATH = tracePath("");

/**
 * Tail-read the trace stream into typed `SubAgentTrace[]` for in-test assertions.
 * Lines that don't parse as a `SubAgentTrace` are skipped (the stream may carry
 * other observability events in later phases). Missing file → empty array.
 */
export function readTraces(repoRoot: string, relativePath: string = TRACES_RELATIVE_PATH): SubAgentTrace[] {
  const full = join(repoRoot, relativePath);
  if (!existsSync(full)) return [];
  const out: SubAgentTrace[] = [];
  for (const line of readFileSync(full, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const result = SubAgentTraceSchema.safeParse(parsed);
    if (result.success) out.push(result.data);
  }
  return out;
}

/** All traces for a given role, in emission order. */
export const tracesForRole = (traces: SubAgentTrace[], role: SubAgentRole): SubAgentTrace[] =>
  traces.filter((t) => t.role === role);

/** The most recent trace (last line), or undefined when the stream is empty. */
export const lastTrace = (traces: SubAgentTrace[]): SubAgentTrace | undefined => traces.at(-1);
