import { dirname } from "node:path";

import type { DecorationRecord } from "@dusk/core-decoration";
import type { DerivedIndex } from "@dusk/core-index";
import { duskError, type AntecedentTriple, type Intent, type RuntimeResult } from "@dusk/core-schema";

/**
 * Deterministic antecedent evaluation for `compose: implies` (RFC §3.2.1; design
 * D4). Evaluates the antecedent group by INDEX LOOKUP against the closed
 * predicate vocabulary — never an LLM call. A `polarity: negative` antecedent
 * triple is a set-complement query. Ambiguous unit resolution returns a typed
 * structural error (never an LLM fallback) — protecting `must`-rules from silent
 * vacuous satisfaction.
 */
export type UnitUnderEvaluation = { file: string; declarationName: string | null };

const FOCAL_MARKERS = new Set(["intent", "intent-file", "intent-test", "intent-test-file"]);

/** Parse `api/write-endpoint[aspect]` → { path, aspect? }. */
function parseObject(object: string): { path: string; aspect?: string } {
  const m = object.match(/^(.*?)\s*\[(.+)\]\s*$/);
  return m ? { path: m[1].trim(), aspect: m[2].trim() } : { path: object.trim() };
}

const onUnit = (r: DecorationRecord, unit: UnitUnderEvaluation): boolean =>
  r.file === unit.file && r.declaration_name === unit.declarationName && FOCAL_MARKERS.has(r.marker);

/** Evaluate one antecedent predicate (before polarity) against the index. */
function predicateHolds(triple: AntecedentTriple, unit: UnitUnderEvaluation, index: DerivedIndex): boolean {
  const { path, aspect } = parseObject(triple.object);
  switch (triple.predicate) {
    case "is decorated with":
      return index.records.some(
        (r) =>
          onUnit(r, unit) &&
          r.intent_path === path &&
          (aspect === undefined || r.aspect_ids === null || r.aspect_ids.includes(aspect)),
      );
    case "claims any aspect of":
      return index.records.some((r) => onUnit(r, unit) && r.intent_path === path);
    case "is enclosed by a decoration of":
      return index.records.some((r) => {
        if (r.intent_path !== path) return false;
        if (r.scope === "file") return r.file === unit.file;
        if (r.scope === "directory") {
          const dir = dirname(r.file);
          return unit.file === r.file || unit.file.startsWith(`${dir}/`);
        }
        return false;
      });
  }
}

export type AntecedentEvaluation = { held: boolean; perTriple: { id: string; held: boolean }[] };

/** Evaluate the antecedent GROUP (conjunction; polarity applied per triple). Pure, zero-LLM. */
export function evaluateAntecedent(intent: Intent, unit: UnitUnderEvaluation, index: DerivedIndex): AntecedentEvaluation {
  const triples = intent.antecedent ?? [];
  const perTriple = triples.map((t) => {
    const raw = predicateHolds(t, unit, index);
    const held = t.polarity === "negative" ? !raw : raw; // set-complement query
    return { id: t.id, held };
  });
  return { held: perTriple.every((t) => t.held), perTriple };
}

/**
 * Resolve the unique unit-under-evaluation carrying an intent. Multiple distinct
 * focal declarations → ambiguous → typed structural error (P2-T7b). Zero
 * declarations → also ambiguous (nothing to bind the antecedent subject to).
 */
export function resolveUnit(intentPath: string, index: DerivedIndex): RuntimeResult<UnitUnderEvaluation> {
  const declarations = index.records.filter(
    (r) => r.intent_path === intentPath && FOCAL_MARKERS.has(r.marker) && r.scope === "declaration",
  );
  const distinct = new Map<string, UnitUnderEvaluation>();
  for (const r of declarations) distinct.set(`${r.file}::${r.declaration_name}`, { file: r.file, declarationName: r.declaration_name });

  if (distinct.size === 1) return { success: true, value: [...distinct.values()][0] };
  return {
    success: false,
    error: duskError(
      "verifier_evidence_too_large",
      `antecedent subject for ${intentPath} binds to ${distinct.size} units (must be exactly one)`,
      { recoverable: false, details: { intentPath, unitCount: distinct.size } },
    ),
  };
}
