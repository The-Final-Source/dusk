import { join } from "node:path";

/**
 * Single source of truth for the `.ia/observability/` artifact layout.
 *
 * These paths were previously constructed ad-hoc in ~6 places (the trace ring
 * buffer, the dogfood writer, the CLI's benchmark + static-analysis writers, the
 * MCP trace reader, and the api metrics reader). When a READER duplicates a
 * WRITER's path string they silently drift — exactly the dogfood finding where
 * the metrics resolver looked under `.ia/artifacts/` while the reports were
 * written under `.ia/observability/`. Every writer and reader now derives its
 * path here, so a reader resolves the same file a writer wrote, by construction.
 *
 * Pure path construction — no I/O. Lives in `@dusk/core-schema` because it is
 * the universal leaf every package (including `packages/api`) already depends on.
 *
 * BAR for additions: this module is the home for cross-cutting CONTRACTS that
 * every package — including `packages/api`, which must NOT couple to the runtime
 * layers — needs. Add a path helper here only if it is the canonical `.ia`
 * layout AND is consumed by more than one package; keep it pure (no I/O). Do not
 * let it become a junk-drawer for "anything api also imports".
 */

/** The trace ring-buffer filename — defined once so writer + readers can't drift. */
export const TRACES_FILENAME = "traces.jsonl";
/** The per-run sweep verdicts filename — the single definition of the literal. */
export const VERDICTS_FILENAME = "verdicts.jsonl";

export function observabilityDir(root: string): string {
  return join(root, ".ia", "observability");
}

export function tracePath(root: string): string {
  return join(observabilityDir(root), TRACES_FILENAME);
}

/**
 * The trace path RELATIVE to a project root (`.ia/observability/traces.jsonl`),
 * built structurally — NOT `tracePath("")`, which only works because `join`
 * drops an empty leading segment (a hidden dependence on join-vs-resolve).
 */
export function relativeTracePath(): string {
  return join(".ia", "observability", TRACES_FILENAME);
}

export function rotatedTracePath(root: string): string {
  return join(observabilityDir(root), "traces.1.jsonl");
}

export function traceCursorPath(root: string, sink: string): string {
  return join(observabilityDir(root), `.cursor-${sink}`);
}

export function dogfoodDir(root: string): string {
  return join(observabilityDir(root), "dogfood");
}

export function dogfoodReportPath(root: string): string {
  return join(dogfoodDir(root), "dogfood-report.json");
}

export function staticAnalysisReportPath(root: string): string {
  return join(observabilityDir(root), "static-analysis-report.json");
}

export function benchmarkRunDir(root: string, runId: string): string {
  return join(observabilityDir(root), "benchmark-runs", runId);
}

export function auditReportPath(root: string, runId: string): string {
  return join(benchmarkRunDir(root, runId), "audit-report.json");
}

export function benchmarkReportPath(root: string, runId: string): string {
  return join(benchmarkRunDir(root, runId), "benchmark-report.json");
}
