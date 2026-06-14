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
 */

export function observabilityDir(root: string): string {
  return join(root, ".ia", "observability");
}

export function tracePath(root: string): string {
  return join(observabilityDir(root), "traces.jsonl");
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

export function benchmarkRunsDir(root: string): string {
  return join(observabilityDir(root), "benchmark-runs");
}

export function benchmarkRunDir(root: string, runId: string): string {
  return join(benchmarkRunsDir(root), runId);
}

export function verdictsPath(root: string, runId: string): string {
  return join(benchmarkRunDir(root, runId), "verdicts.jsonl");
}

export function auditReportPath(root: string, runId: string): string {
  return join(benchmarkRunDir(root, runId), "audit-report.json");
}

export function benchmarkReportPath(root: string, runId: string): string {
  return join(benchmarkRunDir(root, runId), "benchmark-report.json");
}
