import { parseDecorations } from "@dusk/core-decoration";
import type { Intent } from "@dusk/core-schema";
import { describe, expect, it } from "vitest";

import { buildDerivedIndex } from "./derivedIndex.js";
import { analyzeStaticDecoration, conflictsCoDecoration } from "./staticAnalysis.js";

// 6.1–6.4 unit surface — the S ⊄ D fold (conservative default + strict-unknowns)
// and the conflicts-pair co-decoration flag. Zero-model.

const mkIntent = (id: string, conflicts?: string): Intent => ({
  schema_version: 2,
  id,
  description: id,
  obligation: "must",
  compose: "all",
  triples: [{ id: "t", subject: "s", predicate: "p", object: "o", polarity: "positive" }],
  relates_to: conflicts ? [{ kind: "conflicts", target: conflicts }] : [],
});

const intents = new Map<string, Intent>([
  ["demo/alpha", mkIntent("demo/alpha")],
  ["demo/beta", mkIntent("demo/beta")],
]);

function analyze(files: Record<string, string>, mode: "conservative" | "strict-unknowns" = "conservative") {
  const records = Object.entries(files).flatMap(([file, source]) => parseDecorations(source, file));
  const index = buildDerivedIndex(records, intents);
  return analyzeStaticDecoration({ files, index, mode });
}

const erodingSource = `// @intent demo/alpha [t]
export function caller(): string {
  // @intent demo/alpha [t]
  const result = helper();
  // @intent demo/alpha [t]
  return result;
}

// @intent demo/beta [t]
function helper(): string {
  return "beta";
}
`;

describe("S ⊄ D detection with the conservative default (P5-T5)", () => {
  it("a decorated callee with a foreign focal intent erodes the caller", () => {
    const { findings } = analyze({ "src.ts": erodingSource });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ class: "s_not_subset_d", file: "src.ts", line: 4, intents_involved: ["demo/beta"] });
    expect(findings[0].suggestion).toContain("helper");
    expect(findings[0].suggestion).toContain("demo/beta");
  });

  it("cross-file callees resolve through the import graph", () => {
    const { findings } = analyze({
      "src.ts": `import { remote } from "./util.js";

// @intent demo/alpha [t]
export function caller(): string {
  // @intent demo/alpha [t]
  return remote();
}
`,
      "util.ts": `// @intent demo/beta [t]
export function remote(): string {
  // @intent demo/beta [t]
  return "beta";
}
`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ class: "s_not_subset_d", file: "src.ts", intents_involved: ["demo/beta"] });
  });

  it("uninstrumented callees and dynamic calls contribute ∅ — zero spurious findings", () => {
    const { findings } = analyze({
      "src.ts": `// @intent demo/alpha [t]
export function caller(rows: string[]): number {
  // @intent demo/alpha [t]
  const cleaned = plainHelper(rows.filter((r) => r.length > 0));
  // @intent demo/alpha [t]
  return cleaned.length;
}

function plainHelper(rows: string[]): string[] {
  return rows;
}
`,
    });
    expect(findings).toEqual([]);
  });

  it("a callee whose intents are all declared on the caller is clean", () => {
    const { findings } = analyze({
      "src.ts": `// @intent demo/alpha [t]
// @intent demo/beta [t]
export function caller(): string {
  // @intent demo/alpha [t]
  return helper();
}

// @intent demo/beta [t]
function helper(): string {
  return "beta";
}
`,
    });
    expect(findings).toEqual([]);
  });
});

describe("--strict-unknowns separates the two finding classes (P5-T6)", () => {
  it("a true violation and uninstrumented callees are separately countable", () => {
    const source = `// @intent demo/alpha [t]
export function caller(): string {
  // @intent demo/alpha [t]
  const noise = plainHelper();
  // @intent demo/alpha [t]
  return betaHelper(noise);
}

function plainHelper(): string {
  return "plain";
}

// @intent demo/beta [t]
function betaHelper(prefix: string): string {
  return prefix + "beta";
}
`;
    const strict = analyze({ "src.ts": source }, "strict-unknowns");
    const byClass = (cls: string) => strict.findings.filter((f) => f.class === cls);
    expect(byClass("s_not_subset_d")).toHaveLength(1);
    expect(byClass("undecorated_callee")).toHaveLength(1);
    expect(byClass("undecorated_callee")[0].line).toBe(4);

    // The conservative default suppresses ONLY the unknown class.
    const conservative = analyze({ "src.ts": source }, "conservative");
    expect(conservative.findings.filter((f) => f.class === "undecorated_callee")).toHaveLength(0);
    expect(conservative.findings.filter((f) => f.class === "s_not_subset_d")).toHaveLength(1);
  });
});

describe("the density baseline (6.4)", () => {
  it("counts decorated vs undecorated units per file", () => {
    const { density_baseline } = analyze({ "src.ts": erodingSource });
    expect(density_baseline).toEqual([{ file: "src.ts", decorated_units: 2, undecorated_units: 0 }]);
  });
});

describe("the structured StaticAnalysisReport (6.4)", () => {
  it("parses against the schema with the density baseline populated", async () => {
    const { staticAnalysisReport } = await import("./staticAnalysis.js");
    const records = parseDecorations(erodingSource, "src.ts");
    const index = buildDerivedIndex(records, intents);
    const report = staticAnalysisReport({ files: { "src.ts": erodingSource }, index, mode: "strict-unknowns", generatedAt: "2026-06-11T00:00:00.000Z" });
    expect(report.schema_version).toBe(1);
    expect(report.mode).toBe("strict-unknowns");
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.density_baseline).toEqual([{ file: "src.ts", decorated_units: 2, undecorated_units: 0 }]);
  });
});

describe("conflicts-pair co-decoration (P5-T7)", () => {
  const source = `// @intent pagination/cursor [t]
export function page(): string {
  // @intent pagination/offset [t]
  return "page";
}
`;
  const records = parseDecorations(source, "src/page.ts");

  it("a file carrying both sides of a conflicts edge is flagged with file:line", () => {
    const conflicting = new Map<string, Intent>([
      ["pagination/cursor", mkIntent("pagination/cursor", "pagination/offset")],
      ["pagination/offset", mkIntent("pagination/offset")],
    ]);
    const findings = conflictsCoDecoration(buildDerivedIndex(records, conflicting));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      class: "conflicts_co_decoration",
      file: "src/page.ts",
      severity: "error",
      intents_involved: ["pagination/cursor", "pagination/offset"],
    });
  });

  it("co-decoration WITHOUT a conflicts edge is not flagged", () => {
    const unrelated = new Map<string, Intent>([
      ["pagination/cursor", mkIntent("pagination/cursor")],
      ["pagination/offset", mkIntent("pagination/offset")],
    ]);
    expect(conflictsCoDecoration(buildDerivedIndex(records, unrelated))).toEqual([]);
  });
});
