import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { SeededFixture } from "./fixtureManifest.js";

/**
 * Materialize one seeded fixture as a self-contained Dusk mini-project in
 * `targetDir`: `dusk.config.yml` + the fixture's `intents/**` under
 * `.ia/intents/` + its source files at the project root. The gate, the doctor,
 * and the Verifier all see exactly the project the fixture declares.
 */
export function materializeFixtureProject(fixture: SeededFixture, targetDir: string): { sourceFiles: string[] } {
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, "dusk.config.yml"), "version: 1\n", "utf8");

  const intentsSrc = join(fixture.dir, "intents");
  if (existsSync(intentsSrc)) cpSync(intentsSrc, join(targetDir, ".ia/intents"), { recursive: true });

  const sourceFiles: string[] = [];
  for (const rel of fixture.files) {
    if (rel.startsWith("intents/")) continue;
    const target = join(targetDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(fixture.dir, rel), "utf8"), "utf8");
    sourceFiles.push(rel);
  }
  return { sourceFiles };
}
