import { readFileSync } from "node:fs";

import { SubAgentTraceSchema, type Intent, type SubAgentTrace } from "@dusk/core-schema";

import { PYRAMID_SUFFIXES } from "./applicationSource.js";

/**
 * Phase-6 §5.3 — the transcript/provenance checker (design D6; spec
 * `zero-handwritten-audit`). A ZERO-MODEL pure pass.
 *
 * `dusk_author_finalize` DESTROYS `.ia/runtime/dialogs/<id>/` (the Phase-4
 * contract), so live transcripts do not survive authoring. Provenance is
 * therefore asserted against DURABLE records: for every intent under the POC's
 * `.ia/intents/`, a correlating `role: "author"` event in `traces.jsonl` PLUS a
 * finalize `intents_created` record naming it. It also asserts the tree contains
 * ≥1 `polarity: negative` triple, ≥1 closed-vocabulary `compose: implies` intent,
 * and pyramid children at unit + integration + e2e layers.
 *
 * The CHECK logic is pure over its parsed inputs (intents map, author-trace ids,
 * finalize-created ids). The filesystem readers (`readAuthorTraceIds`,
 * `readFinalizeCreatedIds`) are thin seams onto the real POC artifacts; the unit
 * tests below drive the pure `checkProvenance` against small fixtures + an
 * orphaned-intent negative case.
 */

export type ProvenanceViolation =
  | { kind: "orphaned_intent_no_author_trace"; intent_id: string }
  | { kind: "orphaned_intent_no_finalize_record"; intent_id: string }
  | { kind: "missing_negative_polarity_triple" }
  | { kind: "missing_closed_vocab_implies" }
  | { kind: "missing_pyramid_layer"; layer: string };

export type ProvenanceResult = {
  pass: boolean;
  intents_checked: number;
  has_negative_polarity: boolean;
  has_closed_vocab_implies: boolean;
  pyramid_layers_present: string[];
  violations: ProvenanceViolation[];
};

export type CheckProvenanceInput = {
  /** The POC intent tree (id → Intent), e.g. from `loadIntentTree(...).intents`. */
  intents: Map<string, Intent>;
  /** Intent ids that have a correlating `role: "author"` trace event. */
  authorTracedIntentIds: Set<string>;
  /** Intent ids named by some finalize `intents_created` record. */
  finalizeCreatedIntentIds: Set<string>;
};

/** True when any triple in the intent carries `polarity: negative` (across all groups). */
function hasNegativeTriple(intent: Intent): boolean {
  const groups = [...(intent.triples ?? []), ...(intent.antecedent ?? []), ...(intent.consequent ?? [])];
  return groups.some((t) => t.polarity === "negative");
}

/**
 * True when the intent is a `compose: implies` whose antecedent uses the closed
 * predicate vocabulary. `AntecedentTripleSchema` already restricts the predicate
 * to the closed set, so a parsed `compose: implies` intent with a non-empty
 * antecedent IS closed-vocab by construction.
 */
function isClosedVocabImplies(intent: Intent): boolean {
  return intent.compose === "implies" && (intent.antecedent?.length ?? 0) > 0;
}

/** The pyramid suffix this intent id ends with, if any (`unit-tests`/`integration-tests`/`e2e-tests`). */
function pyramidLayerOf(intentId: string): string | undefined {
  const last = intentId.split("/").pop();
  return PYRAMID_SUFFIXES.includes(last as (typeof PYRAMID_SUFFIXES)[number]) ? last : undefined;
}

/** The pure provenance check over already-parsed inputs. Deterministic, zero-model. */
export function checkProvenance(input: CheckProvenanceInput): ProvenanceResult {
  const violations: ProvenanceViolation[] = [];
  const ids = [...input.intents.keys()].sort();

  for (const id of ids) {
    if (!input.authorTracedIntentIds.has(id)) violations.push({ kind: "orphaned_intent_no_author_trace", intent_id: id });
    if (!input.finalizeCreatedIntentIds.has(id)) violations.push({ kind: "orphaned_intent_no_finalize_record", intent_id: id });
  }

  const intents = [...input.intents.values()];
  const hasNegative = intents.some(hasNegativeTriple);
  const hasImplies = intents.some(isClosedVocabImplies);
  if (!hasNegative) violations.push({ kind: "missing_negative_polarity_triple" });
  if (!hasImplies) violations.push({ kind: "missing_closed_vocab_implies" });

  const layersPresent = new Set<string>();
  for (const id of ids) {
    const layer = pyramidLayerOf(id);
    if (layer) layersPresent.add(layer);
  }
  for (const suffix of PYRAMID_SUFFIXES) {
    if (!layersPresent.has(suffix)) violations.push({ kind: "missing_pyramid_layer", layer: suffix });
  }

  return {
    pass: violations.length === 0,
    intents_checked: ids.length,
    has_negative_polarity: hasNegative,
    has_closed_vocab_implies: hasImplies,
    pyramid_layers_present: [...layersPresent].sort(),
    violations,
  };
}

/**
 * Read intent ids that carry a `role: "author"` trace event from a POC
 * `traces.jsonl`. The author trace records the authored intent ids in its
 * `output_summary.intents_created` (an array of intent paths). Tolerant: any
 * string-array field named `intents_created` / `intent_ids`, plus a single
 * `intent_id`, is harvested, so the checker correlates regardless of which the
 * runtime populated.
 */
export function readAuthorTraceIds(tracesPath: string): Set<string> {
  const ids = new Set<string>();
  let raw: string;
  try {
    raw = readFileSync(tracesPath, "utf8");
  } catch {
    return ids;
  }
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const trace = SubAgentTraceSchema.safeParse(parsed);
    if (!trace.success || trace.data.role !== "author") continue;
    collectIntentIds(trace.data, ids);
  }
  return ids;
}

/** Harvest authored intent ids from an author trace's summaries (tolerant of field naming). */
function collectIntentIds(trace: SubAgentTrace, into: Set<string>): void {
  const summaries = [trace.output_summary, trace.input_summary].filter((s): s is Record<string, unknown> => s !== undefined);
  for (const summary of summaries) {
    for (const key of ["intents_created", "intent_ids", "intents"]) {
      const value = summary[key];
      if (Array.isArray(value)) for (const v of value) if (typeof v === "string") into.add(v);
    }
    const single = summary["intent_id"];
    if (typeof single === "string") into.add(single);
  }
}

/**
 * Read the union of intent ids named across finalize `intents_created` records.
 * Accepts a JSONL of `{ intents_created: string[] }` objects (the
 * `FinalizeResult` shape) — the durable finalize record the POC build persists.
 */
export function readFinalizeCreatedIds(finalizeRecordsPath: string): Set<string> {
  const ids = new Set<string>();
  let raw: string;
  try {
    raw = readFileSync(finalizeRecordsPath, "utf8");
  } catch {
    return ids;
  }
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed && typeof parsed === "object" && "intents_created" in parsed) {
      const created = (parsed as { intents_created: unknown }).intents_created;
      if (Array.isArray(created)) for (const v of created) if (typeof v === "string") ids.add(v);
    }
  }
  return ids;
}
