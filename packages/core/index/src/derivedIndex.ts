import type { Intent } from "@dusk/core-schema";
import type { DecorationRecord } from "@dusk/core-decoration";
import { buildIntentGraph, type IntentGraph } from "@dusk/core-graph";

export type FocalSupport = { focal: DecorationRecord[]; support: DecorationRecord[] };

/** Per-(intent,aspect) structural satisfaction input. In Phase 1 there are no Verifier verdicts,
 *  so callers inject this; later phases plug in real verdicts. */
export type SatisfactionInput = (intentPath: string, aspectId: string) => boolean;

export type SatisfactionResult = {
  satisfied: boolean;
  unsatisfiedAspects: string[];
  unsatisfiedChildren: string[];
};

export type DerivedIndex = {
  /** The FULL merged record set — structural records stay visible (keystone): reverse-index, inspect, doctor. */
  records: DecorationRecord[];
  /**
   * The semantic-only subset (`verify !== "structural"`) — the internal partition
   * the satisfaction-bearing consumers read so a comment-less/config claim can
   * never flip a semantic verdict, aspect, or `compose: implies` antecedent
   * (design D6, board M1). Used by `focalSupport`/`aspectRollup` here and by
   * `antecedent.ts`; NOT exposed as the public record set.
   */
  semanticRecords: DecorationRecord[];
  intents: Map<string, Intent>;
  graph: IntentGraph;
  /** intent_path → all claimants. */
  forward: (intentPath: string) => DecorationRecord[];
  /** file → distinct intent paths claimed in it. */
  reverse: (file: string) => string[];
  /** (intent_path, aspect_id) → scoped focal + support claimants. */
  focalSupport: (intentPath: string, aspectId: string) => FocalSupport;
  /** intent_path → triple ids with no focal claimant (structural). */
  aspectRollup: (intentPath: string) => string[];
  /** test-pyramid intent_path → its @intent-test / @intent-test-file claimants. */
  testDiscovery: (intentPath: string) => DecorationRecord[];
  /** parent intent → test claimants grouped by configured pyramid layer. */
  testChildrenByLayer: (parentPath: string, suffixes: string[]) => Record<string, DecorationRecord[]>;
  /** Hierarchical satisfaction: own aspects satisfied AND every direct child satisfied (recursive). */
  isSatisfied: (intentPath: string, satisfied: SatisfactionInput) => SatisfactionResult;
};

function tripleIdsOf(intent: Intent): string[] {
  if (intent.compose === "implies") return (intent.consequent ?? []).map((t) => t.id);
  return (intent.triples ?? []).map((t) => t.id);
}

const FOCAL_MARKERS = new Set(["intent", "intent-file", "intent-test", "intent-test-file"]);
const TEST_MARKERS = new Set(["intent-test", "intent-test-file"]);
const matchesAspect = (record: DecorationRecord, aspectId: string): boolean =>
  record.aspect_ids === null || record.aspect_ids.includes(aspectId);

export function buildDerivedIndex(records: DecorationRecord[], intents: Map<string, Intent>): DerivedIndex {
  const graph = buildIntentGraph(intents);

  // The semantic/structural partition (design D6). `records` stays FULL for the
  // non-semantic consumers (forward/reverse/inspect/doctor); the satisfaction-
  // bearing functions read `semanticRecords` so a structural config claim cannot
  // flip a semantic aspect or antecedent.
  const semanticRecords = records.filter((r) => r.verify !== "structural");

  const forward = (intentPath: string): DecorationRecord[] => records.filter((r) => r.intent_path === intentPath);
  const reverse = (file: string): string[] => [...new Set(records.filter((r) => r.file === file).map((r) => r.intent_path))];

  const focalSupport = (intentPath: string, aspectId: string): FocalSupport => {
    const scoped = semanticRecords.filter((r) => r.intent_path === intentPath && matchesAspect(r, aspectId));
    return {
      focal: scoped.filter((r) => FOCAL_MARKERS.has(r.marker)),
      support: scoped.filter((r) => r.marker === "intent-support"),
    };
  };

  const aspectRollup = (intentPath: string): string[] => {
    const intent = intents.get(intentPath);
    if (!intent) return [];
    const aspectIds = tripleIdsOf(intent);
    const claimed = new Set<string>();
    for (const record of semanticRecords) {
      if (record.intent_path !== intentPath) continue;
      if (record.marker !== "intent" && record.marker !== "intent-file") continue;
      if (record.aspect_ids === null) for (const id of aspectIds) claimed.add(id);
      else for (const id of record.aspect_ids) claimed.add(id);
    }
    return aspectIds.filter((id) => !claimed.has(id));
  };

  const testDiscovery = (intentPath: string): DecorationRecord[] =>
    records.filter((r) => r.intent_path === intentPath && TEST_MARKERS.has(r.marker));

  const testChildrenByLayer = (parentPath: string, suffixes: string[]): Record<string, DecorationRecord[]> => {
    const out: Record<string, DecorationRecord[]> = {};
    for (const suffix of suffixes) {
      const childId = `${parentPath}/${suffix}`;
      if (intents.has(childId)) out[suffix] = testDiscovery(childId);
    }
    return out;
  };

  const directChildren = (intentPath: string): string[] =>
    [...intents.keys()].filter((key) => {
      if (!key.startsWith(`${intentPath}/`)) return false;
      return !key.slice(intentPath.length + 1).includes("/");
    });

  const isSatisfied = (intentPath: string, satisfied: SatisfactionInput): SatisfactionResult => {
    const intent = intents.get(intentPath);
    if (!intent) return { satisfied: false, unsatisfiedAspects: [], unsatisfiedChildren: [] };
    const unsatisfiedAspects = tripleIdsOf(intent).filter((aspectId) => !satisfied(intentPath, aspectId));
    const unsatisfiedChildren = directChildren(intentPath).filter((child) => !isSatisfied(child, satisfied).satisfied);
    return {
      satisfied: unsatisfiedAspects.length === 0 && unsatisfiedChildren.length === 0,
      unsatisfiedAspects,
      unsatisfiedChildren,
    };
  };

  return {
    records,
    semanticRecords,
    intents,
    graph,
    forward,
    reverse,
    focalSupport,
    aspectRollup,
    testDiscovery,
    testChildrenByLayer,
    isSatisfied,
  };
}
