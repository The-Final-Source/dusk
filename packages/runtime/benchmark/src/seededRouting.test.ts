import { describe, expect, it } from "vitest";

import { buildSeededManifest } from "./fixtureManifest.js";
import { gateBlocksAnyFile, realGateLeg, realStaticAnalyzerLeg } from "./realLegs.js";

// P5-T9 (zero-model legs) — per-class detection routes to the designed layer:
// the mechanical class is EXACTLY 100% gate-caught; the static-analysis class
// is doctor-caught AND not gate-caught.

describe("the per-class routing matrix — zero-model legs (P5-T9)", () => {
  const manifest = buildSeededManifest();

  it("the mechanical class is exactly 100% gate-caught", () => {
    expect(manifest.success).toBe(true);
    if (!manifest.success) return;
    const mechanical = manifest.value.fixtures.filter((f) => f.class === "mechanical");
    expect(mechanical).toHaveLength(14);
    const caught = mechanical.filter((f) => realGateLeg(f).blocked);
    expect(caught.length / mechanical.length).toBe(1); // exactly 100%
  });

  it("the static-analysis class is doctor-caught AND not gate-caught", () => {
    expect(manifest.success).toBe(true);
    if (!manifest.success) return;
    const erosion = manifest.value.fixtures.filter((f) => f.class === "static-analysis");
    expect(erosion).toHaveLength(10);
    for (const fixture of erosion) {
      expect(realStaticAnalyzerLeg(fixture).flagged, `${fixture.id} not doctor-caught`).toBe(true);
      expect(gateBlocksAnyFile(fixture), `${fixture.id} wrongly gate-caught`).toBe(false);
    }
  });
});
