import { StaticAnalysisReportSchema, type DensityEntry, type StaticAnalysisReport, type StaticFinding } from "@dusk/core-schema";
import type { DecorationRecord } from "@dusk/core-decoration";

import { parseCallSites, parseFunctionUnits, parseImports, type FunctionUnit } from "./callGraph.js";
import type { DerivedIndex } from "./derivedIndex.js";

/**
 * The `S ⊆ D` decoration-erosion drift detector — Phase 5 design D5 (P5-T5/T6;
 * RFC §4.6, §8.9). For each decorated unit `U`: `D(U)` is the intent set its
 * decorations declare (from the derived index records); `S(U)` is the pure
 * fold over RESOLVED callees' focal intents. **Conservative default:**
 * uninstrumented callees and unresolvable dynamic calls contribute ∅ — no
 * false-positive floods, no heuristics. `--strict-unknowns` additionally emits
 * the distinct `undecorated_callee` class. Zero-model; framed as drift
 * detection (off the write path), never real-time enforcement.
 */

export type StaticAnalysisMode = "conservative" | "strict-unknowns";

export type StaticAnalysisInput = {
  /** Repo-relative source files under analysis. */
  files: Record<string, string>;
  /** The derived index built over those files' decoration records. */
  index: DerivedIndex;
  mode: StaticAnalysisMode;
};

export type StaticAnalysisFindings = {
  findings: StaticFinding[];
  density_baseline: DensityEntry[];
};

type UnitWithIntents = FunctionUnit & { intents: Set<string> };

/** Focal intents decorated on/in a unit: declaration-scope records naming it + statement records within its extent. */
function unitIntents(unit: FunctionUnit, records: DecorationRecord[]): Set<string> {
  const intents = new Set<string>();
  for (const r of records) {
    if (r.file !== unit.file || r.marker !== "intent") continue;
    const onDeclaration = r.scope === "declaration" && r.declaration_name === unit.name && r.line <= unit.startLine;
    const inBody = r.line > unit.startLine && r.line <= unit.endLine;
    if (onDeclaration || inBody) intents.add(r.intent_path);
  }
  return intents;
}

export function analyzeStaticDecoration(input: StaticAnalysisInput): StaticAnalysisFindings {
  const files = Object.keys(input.files).sort();
  const knownFiles = new Set(files);
  const records = input.index.records;

  // Build every function unit (decorated or not) for callee resolution.
  const unitsByFile = new Map<string, UnitWithIntents[]>();
  const unitByKey = new Map<string, UnitWithIntents>();
  for (const file of files) {
    const units = parseFunctionUnits(input.files[file], file).map((u) => ({ ...u, intents: unitIntents(u, records) }));
    unitsByFile.set(file, units);
    for (const u of units) unitByKey.set(`${file} ${u.name}`, u);
  }

  const importsByFile = new Map<string, Map<string, string>>();
  for (const file of files) importsByFile.set(file, parseImports(input.files[file], file, knownFiles));

  const findings: StaticFinding[] = [];
  for (const file of files) {
    for (const unit of unitsByFile.get(file) ?? []) {
      if (unit.intents.size === 0) continue; // only DECORATED units are held to the mandate

      for (const site of parseCallSites(input.files[file], unit)) {
        if (site.callee === unit.name) continue; // self-recursion is not erosion

        // Resolve the callee: same file first, then the import graph.
        let callee: UnitWithIntents | undefined;
        if (site.kind === "identifier") {
          callee = unitByKey.get(`${file} ${site.callee}`);
          if (!callee) {
            const imported = importsByFile.get(file)?.get(site.callee);
            if (imported) callee = unitByKey.get(`${imported} ${site.callee}`);
          }
        }

        if (!callee || callee.intents.size === 0) {
          // Conservative default: uninstrumented / unresolvable-dynamic callees
          // contribute the EMPTY intent set — never a spurious S ⊄ D finding.
          if (input.mode === "strict-unknowns") {
            findings.push({
              class: "undecorated_callee",
              file,
              line: site.line,
              intents_involved: [],
              suggestion: `callee ${site.callee} is ${site.kind === "dynamic" ? "a dynamic invocation" : "undecorated"} — its intent participation is unknown to the S ⊆ D analysis`,
              severity: "info",
            });
          }
          continue;
        }

        const missing = [...callee.intents].filter((intent) => !unit.intents.has(intent)).sort();
        if (missing.length === 0) continue;
        findings.push({
          class: "s_not_subset_d",
          file,
          line: site.line,
          intents_involved: missing,
          suggestion: `callee ${site.callee} participates in ${missing.join(", ")} — declare the intent on ${unit.name} or decompose the call (decorate-or-decompose, RFC §4.5)`,
          severity: "warning",
        });
      }
    }
  }

  const density_baseline: DensityEntry[] = files.map((file) => {
    const units = unitsByFile.get(file) ?? [];
    const decorated = units.filter((u) => u.intents.size > 0).length;
    return { file, decorated_units: decorated, undecorated_units: units.length - decorated };
  });

  return { findings, density_baseline };
}

/**
 * Assemble the structured, schema-valid `StaticAnalysisReport` (6.4; design
 * D10): per-finding `{class, file, line, intents_involved, suggestion,
 * severity}` plus the per-file decoration-density baseline for drift trending.
 */
export function staticAnalysisReport(input: StaticAnalysisInput & { generatedAt: string }): StaticAnalysisReport {
  const { findings, density_baseline } = analyzeStaticDecoration(input);
  return StaticAnalysisReportSchema.parse({
    schema_version: 1,
    generated_at: input.generatedAt,
    mode: input.mode,
    findings,
    density_baseline,
  });
}

/**
 * The conflicts-pair co-decoration flag — Phase 5 P5-T7 (RFC §2.1 `conflicts`
 * row). For every `conflicts` edge (A, B) in the intent graph, any file
 * carrying decorations of BOTH sides is reported with `file:line`. A pure
 * index query — the off-write-path half of the typed-edge semantics (the
 * Decomposer's hard refusal covers bead-issue time).
 */
export function conflictsCoDecoration(index: DerivedIndex): StaticFinding[] {
  const findings: StaticFinding[] = [];
  const seen = new Set<string>();

  for (const intentId of [...index.intents.keys()].sort()) {
    for (const target of index.graph.relatedBy(intentId, "conflicts")) {
      const [a, b] = [intentId, target].sort();
      const pairKey = `${a} ${b}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const filesOfA = new Set(index.forward(a).map((r) => r.file));
      for (const record of index.forward(b)) {
        if (!filesOfA.has(record.file)) continue;
        findings.push({
          class: "conflicts_co_decoration",
          file: record.file,
          line: record.line,
          intents_involved: [a, b],
          suggestion: `intents ${a} and ${b} are linked \`conflicts\` — the same file must not claim both; move one side or resolve the conflict edge`,
          severity: "error",
        });
      }
    }
  }
  return findings;
}
