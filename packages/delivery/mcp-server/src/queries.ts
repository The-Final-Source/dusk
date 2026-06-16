import { existsSync, readFileSync } from "node:fs";

import {
  SubAgentTraceSchema,
  duskError,
  testPyramidSuffixes,
  tracePath,
  verifierEvidenceMaxLines,
  type Intent,
  type RuntimeResult,
  type SubAgentTrace,
  type Verdict,
} from "@dusk/core-schema";
import { verifyIntent } from "@dusk/runtime-verifier";
import { activeBeadSummaries, getActiveRun, type BeadSummary } from "@dusk/runtime-orchestrator";
import { listCheckpoints } from "@dusk/runtime-implement-checkpoint";

import type { DuskContext } from "./context.js";

/**
 * The shared read functions behind both the MCP tools and the equivalent
 * resources (design D10). Each returns a `Result`; the MCP boundary translates
 * it into the success shape or a typed `DuskError`.
 */

const TEST_SUFFIXES_RE = /\/(unit-tests|integration-tests|e2e-tests|contract-tests|property-tests)$/;

const tripleIdsOf = (intent: Intent): string[] =>
  intent.compose === "implies" ? (intent.consequent ?? []).map((t) => t.id) : (intent.triples ?? []).map((t) => t.id);

function scopePaths(ctx: DuskContext, scope: string | string[]): string[] {
  const roots = Array.isArray(scope) ? scope : [scope];
  return [...ctx.intents.keys()].filter((path) => roots.some((root) => path === root || path.startsWith(`${root}/`)));
}

// ---- dusk_status -----------------------------------------------------------

export type StatusResponse = {
  active_beads: never[];
  recent_verdicts: Verdict[];
  recent_test_runs: never[];
  index_stats: { intents: number; decorations: number };
};

export function statusQuery(ctx: DuskContext): RuntimeResult<StatusResponse> {
  return {
    success: true,
    value: {
      active_beads: [],
      recent_verdicts: [...ctx.verdictStore.values()],
      recent_test_runs: [],
      index_stats: { intents: ctx.intents.size, decorations: ctx.index.records.length },
    },
  };
}

// ---- dusk_inspect ----------------------------------------------------------

export type InspectResponse = {
  intents: { path: string; description: string; obligation: string; satisfied: boolean }[];
  claims: { file: string; line: number; intent_path: string; aspect_ids: string[] | null }[];
  support_claims: { file: string; line: number; intent_path: string; aspect_ids: string[] | null; support_triple: [string, string, string] | null }[];
  aspects_unsatisfied: { intent_path: string; aspect_id: string }[];
  test_intents: { path: string; satisfied: boolean }[];
  low_confidence_supports: {
    intent_path: string;
    aspect_id: string;
    claim: { file: string; lines: [number, number]; quote: string };
    support_triple: [string, string, string];
    triple_verdict: string;
  }[];
};

export function inspectQuery(ctx: DuskContext, scope: string | string[]): RuntimeResult<InspectResponse> {
  const paths = scopePaths(ctx, scope);
  if (paths.length === 0) {
    return { success: false, error: duskError("intent_path_unresolved", `no intents in scope: ${JSON.stringify(scope)}`, { recoverable: true }) };
  }

  // (intent, aspect) satisfied iff it has a focal claimant AND (if a recent verdict exists) its focal verdict passed.
  const isAspectSatisfied = (intentPath: string, aspectId: string): boolean => {
    const hasFocal = ctx.index.focalSupport(intentPath, aspectId).focal.length > 0;
    if (!hasFocal) return false;
    const verdict = ctx.verdictStore.get(intentPath);
    const per = verdict?.per_triple.find((t) => t.triple_id === aspectId);
    return per ? per.focal_verdict === "pass" : true;
  };

  const intents = paths.map((path) => {
    const intent = ctx.intents.get(path)!;
    return { path, description: intent.description, obligation: intent.obligation, satisfied: ctx.index.isSatisfied(path, isAspectSatisfied).satisfied };
  });

  const inScope = new Set(paths);
  const claimRecords = ctx.index.records.filter((r) => inScope.has(r.intent_path));
  const claims = claimRecords
    .filter((r) => r.marker === "intent" || r.marker === "intent-file" || r.marker === "intent-test" || r.marker === "intent-test-file")
    .map((r) => ({ file: r.file, line: r.line, intent_path: r.intent_path, aspect_ids: r.aspect_ids }));
  const support_claims = claimRecords
    .filter((r) => r.marker === "intent-support")
    .map((r) => ({ file: r.file, line: r.line, intent_path: r.intent_path, aspect_ids: r.aspect_ids, support_triple: r.support_triple }));

  const aspects_unsatisfied = paths.flatMap((path) => {
    const intent = ctx.intents.get(path)!;
    return tripleIdsOf(intent)
      .filter((aspectId) => !isAspectSatisfied(path, aspectId))
      .map((aspectId) => ({ intent_path: path, aspect_id: aspectId }));
  });

  const test_intents = paths
    .filter((path) => TEST_SUFFIXES_RE.test(path))
    .map((path) => ({ path, satisfied: ctx.index.isSatisfied(path, isAspectSatisfied).satisfied }));

  const low_confidence_supports = paths.flatMap((path) => {
    const verdict = ctx.verdictStore.get(path);
    if (!verdict) return [];
    return verdict.per_triple
      .filter((t) => t.support_quality === "low_confidence")
      .flatMap((t) =>
        t.evidence.support_claims
          .filter((s) => s.triple_verdict !== "matches")
          .map((s) => ({
            intent_path: path,
            aspect_id: t.triple_id,
            claim: { file: s.file, lines: s.lines, quote: s.quote },
            support_triple: s.support_triple,
            triple_verdict: s.triple_verdict,
          })),
      );
  });

  return { success: true, value: { intents, claims, support_claims, aspects_unsatisfied, test_intents, low_confidence_supports } };
}

// ---- dusk_verify -----------------------------------------------------------

export async function verifyQuery(
  ctx: DuskContext,
  args: { scope?: string | string[]; intents?: string[]; diff?: unknown },
): Promise<RuntimeResult<{ verdicts: Verdict[] }>> {
  if (!ctx.modelClient) {
    return { success: false, error: duskError("verifier_model_call_failed", "dusk_verify requires a configured model (the Claude Code CLI, or an injected client)", { recoverable: false }) };
  }
  const targets = args.intents ?? (args.scope ? scopePaths(ctx, args.scope) : [...ctx.intents.keys()]);
  const verdicts: Verdict[] = [];
  for (const path of targets) {
    const intent = ctx.intents.get(path);
    if (!intent) return { success: false, error: duskError("intent_path_unresolved", `intent not found: ${path}`, { recoverable: true }) };
    const result = await verifyIntent(intent, {
      index: ctx.index,
      readFile: ctx.readFile,
      maxLines: verifierEvidenceMaxLines(ctx.config),
      modelClient: ctx.modelClient,
      systemPrompt: ctx.systemPrompt,
    });
    if (!result.success) return result;
    ctx.verdictStore.set(path, result.value);
    verdicts.push(result.value);
  }
  return { success: true, value: { verdicts } };
}

// ---- paired list/get -------------------------------------------------------

export function listIntentsQuery(ctx: DuskContext): RuntimeResult<{ intents: { path: string; description: string; obligation: string }[] }> {
  const intents = [...ctx.intents.values()]
    .map((i) => ({ path: i.id, description: i.description, obligation: i.obligation }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { success: true, value: { intents } };
}

export function getIntentQuery(ctx: DuskContext, path: string): RuntimeResult<{ intent: Intent }> {
  const intent = ctx.intents.get(path);
  if (!intent) return { success: false, error: duskError("intent_path_unresolved", `intent not found: ${path}`, { recoverable: true }) };
  return { success: true, value: { intent } };
}

export function listTracesQuery(ctx: DuskContext, opts: { limit?: number } = {}): RuntimeResult<{ traces: SubAgentTrace[] }> {
  const path = tracePath(ctx.rootDir);
  if (!existsSync(path)) return { success: true, value: { traces: [] } };
  const traces: SubAgentTrace[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = SubAgentTraceSchema.safeParse(JSON.parse(line));
      if (parsed.success) traces.push(parsed.data);
    } catch {
      // skip non-trace lines
    }
  }
  const limited = opts.limit ? traces.slice(-opts.limit) : traces;
  return { success: true, value: { traces: limited } };
}

// ---- dusk_list_beads (14.1): populated during an in-flight pipeline ----------

export function listBeadsQuery(_ctx: DuskContext): RuntimeResult<{ beads: BeadSummary[] }> {
  // Reads the in-process active-run registry; empty when no pipeline is in flight.
  return { success: true, value: { beads: activeBeadSummaries() } };
}

export function getBeadQuery(_ctx: DuskContext, beadId: string): RuntimeResult<{ id: string; status: string; current_step: string | null; branch: string | null; started_at: string | null }> {
  const bead = getActiveRun()?.beads.get(beadId);
  if (!bead) return { success: true, value: { id: beadId, status: "unknown", current_step: null, branch: null, started_at: null } };
  return { success: true, value: { id: bead.id, status: bead.status, current_step: bead.current_step, branch: bead.branch, started_at: bead.started_at } };
}

// ---- dusk_list_implement_checkpoints (14.2): outstanding paused checkpoints ----

export type CheckpointEntry = { resume_token: string; original_request: string; created_at: string; last_touched_at: string; unresolved_refs: string[] };

export function listCheckpointsQuery(ctx: DuskContext): RuntimeResult<{ checkpoints: CheckpointEntry[] }> {
  const checkpoints = listCheckpoints(ctx.rootDir).map(({ token, checkpoint }) => ({
    resume_token: token,
    original_request: checkpoint.original_request,
    created_at: checkpoint.created_at,
    last_touched_at: checkpoint.last_touched_at,
    unresolved_refs: checkpoint.unresolved_refs,
  }));
  return { success: true, value: { checkpoints } };
}
