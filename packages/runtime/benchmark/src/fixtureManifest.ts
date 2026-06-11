import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { duskError, err, ok, FixtureClassSchema, type RuntimeResult } from "@dusk/core-schema";

/**
 * Seeded-violations manifest build — Phase 5 design D7. Assembles
 * `manifest.json` from the per-fixture `fixture.yaml`s and enforces the
 * marker-comment drift guard: every `ground_truth_defect_loc` must point at a
 * line carrying its `// SEEDED: <id>` marker. Any mismatch fails the build
 * naming the fixture — Axis 3's ground truth cannot silently rot.
 */

export const GROUND_TRUTH_OUTCOMES = [
  "gate_reject",
  "doctor_flag",
  "verifier_reject",
  "verifier_test_reject",
  "verifier_accept",
  "controversial",
] as const;
export const GroundTruthOutcomeSchema = z.enum(GROUND_TRUTH_OUTCOMES);
export type GroundTruthOutcome = z.infer<typeof GroundTruthOutcomeSchema>;

export const SeededFixtureSchema = z
  .object({
    id: z.string().min(1),
    class: FixtureClassSchema,
    ground_truth_outcome: GroundTruthOutcomeSchema,
    expected_rejection_kind: z.string().optional(),
    ground_truth_defect_loc: z.object({ file: z.string(), line: z.number().int().min(1) }).strict().optional(),
    calibration: z.boolean().optional(),
    description: z.string(),
  })
  .strict();
export type SeededFixtureMeta = z.infer<typeof SeededFixtureSchema>;

export type SeededFixture = SeededFixtureMeta & {
  /** Absolute fixture directory. */
  dir: string;
  /** Fixture-relative source/intent file paths (fixture.yaml excluded). */
  files: string[];
};

export type SeededManifest = {
  schema_version: 1;
  fixture_count: number;
  classes: Record<string, number>;
  calibration_fixture_ids: string[];
  fixtures: SeededFixture[];
};

/** The checked-in fixture package root (workspace-excluded; design D7). */
export function seededViolationsRoot(): string {
  return fileURLToPath(new URL("../../../fixtures/seeded-violations", import.meta.url));
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

function fixtureDirs(root: string): string[] {
  const dirs: string[] = [];
  const walk = (d: string): void => {
    if (existsSync(join(d, "fixture.yaml"))) {
      dirs.push(d);
      return;
    }
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
    }
  };
  for (const cls of ["mechanical", "static-analysis", "verification", "two-stage-test"]) {
    const clsDir = join(root, cls);
    if (existsSync(clsDir)) walk(clsDir);
  }
  return dirs.sort();
}

/**
 * Build the manifest from the authored fixtures. Fails (typed error) when a
 * fixture's `ground_truth_defect_loc` does not point at its marker line.
 */
export function buildSeededManifest(root: string = seededViolationsRoot()): RuntimeResult<SeededManifest> {
  if (!existsSync(root)) {
    return err(duskError("config_invalid", `seeded-violations root not found at ${root}`, { recoverable: false }));
  }

  const fixtures: SeededFixture[] = [];
  for (const dir of fixtureDirs(root)) {
    const raw = parseYaml(readFileSync(join(dir, "fixture.yaml"), "utf8"));
    const parsed = SeededFixtureSchema.safeParse(raw);
    if (!parsed.success) {
      return err(duskError("config_invalid", `fixture.yaml at ${relative(root, dir)} is invalid: ${parsed.error.issues[0]?.message}`, { recoverable: false }));
    }
    const meta = parsed.data;

    // Drift guard (D7): the defect line must carry `// SEEDED: <id>`.
    if (meta.ground_truth_defect_loc) {
      const { file, line } = meta.ground_truth_defect_loc;
      const sourcePath = join(dir, file);
      if (!existsSync(sourcePath)) {
        return err(duskError("config_invalid", `fixture ${meta.id}: ground_truth_defect_loc names missing file ${file}`, { recoverable: false }));
      }
      const lines = readFileSync(sourcePath, "utf8").split(/\r?\n/);
      const marker = `// SEEDED: ${meta.id}`;
      const actual = lines[line - 1] ?? "";
      if (!actual.includes(marker)) {
        return err(
          duskError(
            "config_invalid",
            `fixture ${meta.id}: ground_truth_defect_loc drifted — ${file}:${line} does not carry "${marker}" (the defect line moved without updating fixture.yaml)`,
            { recoverable: false, details: { fixture_id: meta.id, file, line } },
          ),
        );
      }
    }

    fixtures.push({ ...meta, dir, files: listFiles(dir).filter((f) => f !== "fixture.yaml") });
  }

  const classes: Record<string, number> = {};
  for (const f of fixtures) classes[f.class] = (classes[f.class] ?? 0) + 1;

  return ok({
    schema_version: 1,
    fixture_count: fixtures.length,
    classes,
    calibration_fixture_ids: fixtures.filter((f) => f.calibration === true).map((f) => f.id),
    fixtures,
  });
}

/** Build + write `manifest.json` into the fixture package root. */
export function writeSeededManifest(root: string = seededViolationsRoot()): RuntimeResult<SeededManifest> {
  const result = buildSeededManifest(root);
  if (!result.success) return result;
  const serializable = {
    ...result.value,
    fixtures: result.value.fixtures.map((f) => ({ ...f, dir: relative(root, f.dir) })),
  };
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(serializable, null, 2)}\n`, "utf8");
  return result;
}
