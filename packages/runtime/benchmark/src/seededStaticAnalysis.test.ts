import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseDecorations } from "@dusk/core-decoration";
import { analyzeStaticDecoration, buildDerivedIndex } from "@dusk/core-index";
import { loadIntent } from "@dusk/core-parser";
import type { Intent } from "@dusk/core-schema";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { buildSeededManifest, type SeededFixture } from "./fixtureManifest.js";

// P5-T5 / P5-T6 — the S ⊄ D detector over the seeded static-analysis class.
// Zero-model: every seeded erosion is reported with file:line + a suggested
// decomposition; the conservative default never flags undecorated helpers.

function loadFixture(fixture: SeededFixture) {
  const files: Record<string, string> = {};
  const intents = new Map<string, Intent>();
  for (const rel of fixture.files) {
    if (rel.startsWith("intents/") && rel.endsWith("intent.yaml")) {
      const result = loadIntent(parseYaml(readFileSync(join(fixture.dir, rel), "utf8")));
      if (result.success) intents.set(result.intent.id, result.intent);
      continue;
    }
    files[rel] = readFileSync(join(fixture.dir, rel), "utf8");
  }
  const records = Object.entries(files).flatMap(([file, source]) => parseDecorations(source, file));
  return { files, index: buildDerivedIndex(records, intents) };
}

describe("every seeded S ⊄ D violation is doctor-caught at its ground-truth location (P5-T5)", () => {
  const manifest = buildSeededManifest();

  it("reports each of the 10 seeded erosions with file:line + a suggested decomposition; no model call", () => {
    expect(manifest.success).toBe(true);
    if (!manifest.success) return;
    const erosionFixtures = manifest.value.fixtures.filter((f) => f.class === "static-analysis");
    expect(erosionFixtures).toHaveLength(10);

    for (const fixture of erosionFixtures) {
      const { files, index } = loadFixture(fixture);
      const { findings } = analyzeStaticDecoration({ files, index, mode: "conservative" });
      const loc = fixture.ground_truth_defect_loc!;

      const atSeededLine = findings.filter((f) => f.class === "s_not_subset_d" && f.file === loc.file && f.line === loc.line);
      expect(atSeededLine.length, `fixture ${fixture.id}: no S⊄D finding at ${loc.file}:${loc.line} — got ${JSON.stringify(findings)}`).toBe(1);
      expect(atSeededLine[0].suggestion.length).toBeGreaterThan(0);
      expect(atSeededLine[0].intents_involved.length).toBeGreaterThan(0);

      // The conservative default: every finding is a true S⊄D — undecorated
      // helpers/dynamic calls never produce findings in this mode.
      expect(findings.every((f) => f.class === "s_not_subset_d")).toBe(true);
    }
  });

  it("--strict-unknowns adds the distinct undecorated_callee class without disturbing the S⊄D findings (P5-T6)", () => {
    expect(manifest.success).toBe(true);
    if (!manifest.success) return;
    const fixture = manifest.value.fixtures.find((f) => f.id === "static-analysis/erosion-with-undecorated-helper")!;
    const { files, index } = loadFixture(fixture);

    const strict = analyzeStaticDecoration({ files, index, mode: "strict-unknowns" });
    const erosions = strict.findings.filter((f) => f.class === "s_not_subset_d");
    const unknowns = strict.findings.filter((f) => f.class === "undecorated_callee");
    expect(erosions).toHaveLength(1);
    expect(unknowns.length).toBeGreaterThanOrEqual(1); // the plainHelper call
    expect(strict.density_baseline.find((d) => d.file === "src.ts")).toMatchObject({ decorated_units: 2, undecorated_units: 1 });
  });
});
