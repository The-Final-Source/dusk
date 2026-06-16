import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { invokeHook } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildSeededManifest, type SeededFixture } from "./fixtureManifest.js";
import { materializeFixtureProject } from "./fixtureProject.js";

// 3.1 — every mechanical fixture piped through the REAL gate (out-of-process
// hook) is rejected with its expected kind; every non-mechanical fixture is
// gate-clean (its defect belongs to a different detection layer). Zero-model +
// real hook process.

const GATE = fileURLToPath(new URL("../../../delivery/pre-tool-use/dist/cli.js", import.meta.url));

type HookOutput =
  | { decision: "approve" }
  | { decision: "block"; reason: string; structured_rejection: { kind: string; file: string; line: number } };

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "dusk-gate-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

// Run the REAL out-of-process gate in --json (machine-readable) mode so we can
// assert the structured rejection kind; `exitCode` is the production block
// signal (2 = block, 0 = approve — the same exit code the Claude Code hook uses).
const gateFile = (projectDir: string, fixture: SeededFixture, rel: string): { output: HookOutput; exitCode: number } => {
  const content = readFileSync(join(fixture.dir, rel), "utf8");
  const result = invokeHook(GATE, { tool: "Write", args: { file_path: join(projectDir, rel), content } }, { json: true });
  return { output: result.output as HookOutput, exitCode: result.exitCode };
};

describe("P5 §3.1 — the mechanical class through the real gate", () => {
  const manifest = buildSeededManifest();

  it("every mechanical fixture is gate-rejected with its expected kind", () => {
    expect(manifest.success).toBe(true);
    if (!manifest.success) return;
    const mechanical = manifest.value.fixtures.filter((f) => f.class === "mechanical");
    expect(mechanical.length).toBe(14);

    for (const fixture of mechanical) {
      const projectDir = join(tmp, fixture.id.replaceAll("/", "__"));
      const { sourceFiles } = materializeFixtureProject(fixture, projectDir);
      const defectFile = fixture.ground_truth_defect_loc!.file;
      expect(sourceFiles).toContain(defectFile);

      const { output, exitCode } = gateFile(projectDir, fixture, defectFile);
      expect(exitCode, `fixture ${fixture.id} did not exit 2 (the block signal)`).toBe(2);
      expect(output.decision, `fixture ${fixture.id} was not blocked`).toBe("block");
      if (output.decision !== "block") continue;
      expect(output.structured_rejection.kind, `fixture ${fixture.id} rejected with the wrong kind`).toBe(fixture.expected_rejection_kind);
    }
  });

  it("every non-mechanical fixture is gate-clean (the defect belongs to another layer)", () => {
    expect(manifest.success).toBe(true);
    if (!manifest.success) return;
    const others = manifest.value.fixtures.filter((f) => f.class !== "mechanical");

    for (const fixture of others) {
      const projectDir = join(tmp, fixture.id.replaceAll("/", "__"));
      const { sourceFiles } = materializeFixtureProject(fixture, projectDir);
      for (const rel of sourceFiles) {
        const { output, exitCode } = gateFile(projectDir, fixture, rel);
        expect(exitCode, `fixture ${fixture.id} file ${rel} was unexpectedly gate-blocked`).toBe(0);
        expect(output.decision, `fixture ${fixture.id} file ${rel} was unexpectedly gate-blocked: ${JSON.stringify(output)}`).toBe("approve");
      }
    }
  });
});
