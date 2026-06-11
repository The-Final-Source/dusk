import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseDecorations } from "@dusk/core-decoration";
import { loadIntentTree } from "@dusk/core-graph";
import { analyzeStaticDecoration, buildDerivedIndex } from "@dusk/core-index";
import { runGate, type HookInput } from "@dusk/pre-tool-use";

import type { SeededFixture } from "./fixtureManifest.js";
import { materializeFixtureProject } from "./fixtureProject.js";

/**
 * The non-model detection legs the benchmark sweep routes to (design D6):
 * the REAL PreToolUse gate (mechanical class) and the REAL static-analysis
 * detector (static-analysis class), each run against the fixture's
 * materialized mini-project. One implementation shared by the CLI and the
 * routing tests.
 */

export function realGateLeg(fixture: SeededFixture): { blocked: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "dusk-gate-leg-"));
  try {
    materializeFixtureProject(fixture, dir);
    const file = fixture.ground_truth_defect_loc?.file ?? fixture.files.find((f) => !f.startsWith("intents/"))!;
    const input: HookInput = {
      tool: "Write",
      args: { file_path: join(dir, file), content: readFileSync(join(fixture.dir, file), "utf8") },
    };
    return { blocked: runGate(input).decision === "block" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** True when ANY of the fixture's source files would be gate-blocked. */
export function gateBlocksAnyFile(fixture: SeededFixture): boolean {
  const dir = mkdtempSync(join(tmpdir(), "dusk-gate-any-"));
  try {
    const { sourceFiles } = materializeFixtureProject(fixture, dir);
    return sourceFiles.some((rel) => {
      const input: HookInput = { tool: "Write", args: { file_path: join(dir, rel), content: readFileSync(join(fixture.dir, rel), "utf8") } };
      return runGate(input).decision === "block";
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function realStaticAnalyzerLeg(fixture: SeededFixture): { flagged: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "dusk-static-leg-"));
  try {
    materializeFixtureProject(fixture, dir);
    const files: Record<string, string> = {};
    for (const rel of fixture.files) {
      if (rel.startsWith("intents/")) continue;
      files[rel] = readFileSync(join(fixture.dir, rel), "utf8");
    }
    const tree = loadIntentTree(join(dir, ".ia/intents"));
    const records = Object.entries(files).flatMap(([file, source]) => parseDecorations(source, file));
    const index = buildDerivedIndex(records, tree.intents);
    const { findings } = analyzeStaticDecoration({ files, index, mode: "conservative" });
    const loc = fixture.ground_truth_defect_loc;
    return { flagged: findings.some((f) => f.class === "s_not_subset_d" && (!loc || (f.file === loc.file && f.line === loc.line))) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
