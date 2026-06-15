import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { createIgnoreMatcher, loadIgnoreGlobs, scanDecorations, type IgnoreMatcher } from "@dusk/core-decoration";
import { loadIntentTree } from "@dusk/core-graph";
import {
  analyzeStaticDecoration,
  buildDerivedIndex,
  conflictsCoDecoration,
  type StaticAnalysisMode,
} from "@dusk/core-index";
import { DuskConfigSchema, StaticAnalysisReportSchema, intentsDir, staticAnalysisReportPath, type StaticAnalysisReport, type StaticFinding } from "@dusk/core-schema";
import { parse as parseYaml } from "yaml";

/**
 * `dusk doctor --static-analysis` (8.2) — the off-write-path decoration-erosion
 * drift detector (RFC §4.6, §8.9; design D5). Conservative by default;
 * `--strict-unknowns` adds the distinct `undecorated_callee` class. The base
 * doctor's conflicts-pair co-decoration flag (P5-T7) rides along in the same
 * structured report. Zero-model.
 */

// TypeScript-only file map for the S ⊆ D call-graph density (config has no call
// graph — leave it TS-scoped, design D6). The former hardcoded `SKIP_DIRS` is
// gone: pruning now consults the single `decoration.ignore` SSoT (board M2).
const SOURCE_EXT = new Set([".ts", ".tsx"]);

function collectSources(rootDir: string, isIgnored: IgnoreMatcher, scope?: string): Record<string, string> {
  const files: Record<string, string> = {};
  const start = scope ? join(rootDir, scope) : rootDir;
  if (!existsSync(start)) return files;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = relative(rootDir, full);
      if (isIgnored(rel)) continue;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      const dot = entry.lastIndexOf(".");
      if (dot === -1 || !SOURCE_EXT.has(entry.slice(dot)) || entry.endsWith(".d.ts")) continue;
      files[rel] = readFileSync(full, "utf8");
    }
  };
  walk(start);
  return files;
}

export type StaticAnalysisCliResult = { ok: boolean; text: string; report?: StaticAnalysisReport };

export function runStaticAnalysis(
  rootDir: string,
  opts: { strictUnknowns?: boolean; scope?: string; now?: () => number } = {},
): StaticAnalysisCliResult {
  const mode: StaticAnalysisMode = opts.strictUnknowns ? "strict-unknowns" : "conservative";
  const configPath = join(rootDir, "dusk.config.yml");
  let config = DuskConfigSchema.parse({});
  if (existsSync(configPath)) {
    try {
      config = DuskConfigSchema.parse(parseYaml(readFileSync(configPath, "utf8")) ?? {});
    } catch {
      // defaults on malformed config
    }
  }

  const ignoreGlobs = loadIgnoreGlobs(config);
  const isIgnored = createIgnoreMatcher(ignoreGlobs);
  const files = collectSources(rootDir, isIgnored, opts.scope);
  const tree = loadIntentTree(join(rootDir, intentsDir(config)));
  // Index records come from the shared scanner so directory `.intent` and per-file
  // sidecar records are visible to doctor too (keystone), not only the TS files.
  const records = scanDecorations(rootDir, { ignore: ignoreGlobs });
  const index = buildDerivedIndex(records, tree.intents);

  const { findings, density_baseline } = analyzeStaticDecoration({ files, index, mode });
  const conflicts = conflictsCoDecoration(index);
  const allFindings: StaticFinding[] = [...findings, ...conflicts];

  const report = StaticAnalysisReportSchema.parse({
    schema_version: 1,
    generated_at: new Date((opts.now ?? (() => Date.now()))()).toISOString(),
    mode,
    findings: allFindings,
    density_baseline,
  });

  const reportPath = staticAnalysisReportPath(rootDir);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const counts = new Map<string, number>();
  for (const f of allFindings) counts.set(f.class, (counts.get(f.class) ?? 0) + 1);
  const decorated = density_baseline.reduce((a, d) => a + d.decorated_units, 0);
  const undecorated = density_baseline.reduce((a, d) => a + d.undecorated_units, 0);

  const lines = [
    `doctor --static-analysis (${mode})${opts.scope ? ` over ${opts.scope}` : ""}`,
    `  density: ${decorated} decorated / ${undecorated} undecorated units across ${density_baseline.length} files`,
    ...(allFindings.length === 0
      ? ["  findings: none"]
      : [...counts.entries()].map(([cls, n]) => `  ${cls}: ${n}`)),
    ...allFindings.slice(0, 50).map((f) => `    ${f.file}:${f.line}  [${f.class}] ${f.suggestion}`),
    `  report: ${relative(rootDir, staticAnalysisReportPath(rootDir))}`,
  ];
  return { ok: true, text: `${lines.join("\n")}\n`, report };
}
