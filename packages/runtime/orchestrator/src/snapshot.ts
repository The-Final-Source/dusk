import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";

/**
 * Session-snapshot index (RFC §2.10; design D1). Built ONCE at pipeline entry by
 * querying the Phase-1 derived-index against the merge-base commit (default
 * `origin/main`). Frozen for the run's lifetime and identified by
 * `index_snapshot_id = sha256(merge_base_commit + index_serialization)`. Every
 * `SubAgentTrace` carries the id. The query interface is the unchanged Phase-1 D6
 * contract — only the backing store (this frozen snapshot + per-bead deltas)
 * differs.
 */

export type SessionSnapshot = {
  /** `index_snapshot_id` stamped on every trace this run. */
  id: string;
  /** The resolved merge-base commit SHA the snapshot was derived from. */
  mergeBaseCommit: string;
  /** The ref the merge-base was resolved from (e.g. `origin/main`). */
  baseRef: string;
  /** The frozen derived-index (Phase-1 query interface). */
  index: DerivedIndex;
};

export const DEFAULT_BASE_REF = "origin/main";

/** Resolve a ref to a commit SHA via real git. */
export function resolveCommit(repoDir: string, ref: string): string {
  return execFileSync("git", ["rev-parse", ref], { cwd: repoDir, encoding: "utf8" }).trim();
}

/**
 * Canonical, deterministic serialization of the derived index for hashing.
 * Records are sorted by (file, line, marker, intent_path); intents by id. Two
 * indices over the same repo state serialize byte-identically.
 */
export function serializeIndex(index: DerivedIndex): string {
  const records = [...index.records]
    .map((r) => ({
      file: r.file,
      line: r.line,
      marker: r.marker,
      intent_path: r.intent_path,
      aspect_ids: r.aspect_ids,
      scope: r.scope,
      declaration_name: r.declaration_name,
      support_triple: r.support_triple,
    }))
    .sort((a, b) =>
      a.file !== b.file
        ? a.file.localeCompare(b.file)
        : a.line !== b.line
          ? a.line - b.line
          : a.marker !== b.marker
            ? a.marker.localeCompare(b.marker)
            : a.intent_path.localeCompare(b.intent_path),
    );
  const intents = [...index.intents.keys()].sort().map((id) => {
    const intent = index.intents.get(id)!;
    const tripleIds = [...(intent.triples ?? []), ...(intent.antecedent ?? []), ...(intent.consequent ?? [])]
      .map((t) => t.id)
      .sort();
    return { id, compose: intent.compose, obligation: intent.obligation, triples: tripleIds };
  });
  return JSON.stringify({ records, intents });
}

export function computeSnapshotId(mergeBaseCommit: string, index: DerivedIndex): string {
  return createHash("sha256").update(mergeBaseCommit).update("\n").update(serializeIndex(index)).digest("hex");
}

export type BuildSnapshotDeps = {
  repoDir: string;
  baseRef?: string;
  /**
   * Produces the derived index for the merge-base tree. Injected so the
   * orchestrator package does not own the parser stack (the CLI/MCP caller that
   * already parses the repo supplies it). Receives `(records, intents)`-built
   * index from the caller.
   */
  buildIndex: () => DerivedIndex;
  /** git ref resolver override (tests inject a deterministic one if needed). */
  resolveCommit?: (repoDir: string, ref: string) => string;
};

/** Build a fresh session snapshot from the merge-base. */
export function buildSessionSnapshot(deps: BuildSnapshotDeps): SessionSnapshot {
  const baseRef = deps.baseRef ?? DEFAULT_BASE_REF;
  const resolve = deps.resolveCommit ?? resolveCommit;
  const mergeBaseCommit = resolve(deps.repoDir, baseRef);
  const index = deps.buildIndex();
  return { id: computeSnapshotId(mergeBaseCommit, index), mergeBaseCommit, baseRef, index };
}

/**
 * Session-scoped snapshot cache. A snapshot is frozen for the run; a re-invocation
 * in the same session reuses it UNLESS `--rebuild-index` forces re-derivation
 * (which picks up an advanced merge-base → a new id; design D1, Q2).
 */
const sessionSnapshots = new Map<string, SessionSnapshot>();

export type GetSnapshotOptions = { rebuildIndex?: boolean };

export function getOrBuildSnapshot(
  sessionId: string,
  deps: BuildSnapshotDeps,
  options: GetSnapshotOptions = {},
): SessionSnapshot {
  const cached = sessionSnapshots.get(sessionId);
  if (cached && !options.rebuildIndex) return cached;
  const snapshot = buildSessionSnapshot(deps);
  sessionSnapshots.set(sessionId, snapshot);
  return snapshot;
}

/** Forget a session's cached snapshot (run teardown / tests). */
export function clearSnapshot(sessionId: string): void {
  sessionSnapshots.delete(sessionId);
}

/** Build a derived index from raw records + intents (convenience for callers). */
export function indexFromRecords(records: DecorationRecord[], intents: DerivedIndex["intents"]): DerivedIndex {
  return buildDerivedIndex(records, intents);
}
