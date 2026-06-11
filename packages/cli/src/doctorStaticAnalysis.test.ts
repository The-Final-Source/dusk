import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runStaticAnalysis } from "./doctorStaticAnalysis.js";

// 8.2 — `dusk doctor --static-analysis` surfaces the structured report; both
// modes share one report shape, strict adding the undecorated_callee class.
// Zero-model.

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dusk-doctor-sa-"));
  writeFileSync(join(root, "dusk.config.yml"), "version: 1\n", "utf8");
  mkdirSync(join(root, ".ia/intents/demo/alpha"), { recursive: true });
  mkdirSync(join(root, ".ia/intents/demo/beta"), { recursive: true });
  const intent = (id: string): string =>
    `schema_version: 2\nid: ${id}\ndescription: ${id}\nobligation: must\ncompose: all\ntriples:\n  - id: t\n    subject: s\n    predicate: p\n    object: o\n`;
  writeFileSync(join(root, ".ia/intents/demo/alpha/intent.yaml"), intent("demo/alpha"), "utf8");
  writeFileSync(join(root, ".ia/intents/demo/beta/intent.yaml"), intent("demo/beta"), "utf8");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src/feature.ts"),
    `// @intent demo/alpha [t]
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
`,
    "utf8",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("dusk doctor --static-analysis produces the structured report", () => {
  it("conservative mode reports the S⊄D finding and the density baseline; the report file is written", () => {
    const result = runStaticAnalysis(root, { now: () => 1_750_000_000_000 });
    expect(result.ok).toBe(true);
    expect(result.report!.mode).toBe("conservative");
    expect(result.report!.findings.map((f) => f.class)).toEqual(["s_not_subset_d"]);
    expect(result.report!.density_baseline.find((d) => d.file === "src/feature.ts")).toMatchObject({ decorated_units: 2, undecorated_units: 1 });
    expect(result.text).toContain("s_not_subset_d");
    expect(existsSync(join(root, ".ia/observability/static-analysis-report.json"))).toBe(true);
  });

  it("--strict-unknowns adds the undecorated_callee class to the SAME report shape", () => {
    const result = runStaticAnalysis(root, { strictUnknowns: true, now: () => 1_750_000_000_000 });
    expect(result.ok).toBe(true);
    expect(result.report!.mode).toBe("strict-unknowns");
    const classes = new Set(result.report!.findings.map((f) => f.class));
    expect(classes).toEqual(new Set(["s_not_subset_d", "undecorated_callee"]));
    // Same shape: both modes parse against the one StaticAnalysisReport schema.
    expect(Object.keys(result.report!).sort()).toEqual(["density_baseline", "findings", "generated_at", "mode", "schema_version"]);
  });
});
