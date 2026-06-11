import type { ImportGraph } from "@dusk/runtime-long-cycle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSeededManifest } from "./fixtureManifest.js";
import { scoreCitationPrecision } from "./citationPrecision.js";

// P5-T2 — citation precision via structural parse (unit-only; design D2).
// The five-row scoring table + the zero-model-call property.

const groundTruth = { file: "src/notify.ts", line: 40 };
const graph: ImportGraph = {
  imports: (file) => (file === "src/notify.ts" ? ["src/db.ts"] : []),
  importedBy: (file) => (file === "src/notify.ts" ? ["src/api.ts"] : []),
};
const noEvidence = { focal_claims: [] };

describe("the three-tier scoring table (P5-T2)", () => {
  it("a citation within ±2 lines in the defect file scores aligned", () => {
    const score = scoreCitationPrecision("the defect is at src/notify.ts:42 — publish precedes insert", noEvidence, groundTruth, graph);
    expect(score).toEqual({ tier: "aligned", no_citation: false });
  });

  it("a same-file citation beyond ±2 lines scores adjacent", () => {
    const score = scoreCitationPrecision("see src/notify.ts:90 for the setup", noEvidence, groundTruth, graph);
    expect(score).toEqual({ tier: "adjacent", no_citation: false });
  });

  it("a citation in a 1-hop-import file scores adjacent", () => {
    const score = scoreCitationPrecision("the insert helper at src/db.ts:12 is bypassed", noEvidence, groundTruth, graph);
    expect(score).toEqual({ tier: "adjacent", no_citation: false });
  });

  it("a wrong-file citation scores unaligned", () => {
    const score = scoreCitationPrecision("the issue is in src/unrelated.ts:5", noEvidence, groundTruth, graph);
    expect(score).toEqual({ tier: "unaligned", no_citation: false });
  });

  it("an absent citation scores unaligned AND raises the no-citation flag", () => {
    const score = scoreCitationPrecision("this code does not satisfy the intent", noEvidence, groundTruth, graph);
    expect(score).toEqual({ tier: "unaligned", no_citation: true });
  });
});

describe("structured evidence and citation forms", () => {
  it("structured focal_claim line ranges count as citations", () => {
    const score = scoreCitationPrecision("rejected", { focal_claims: [{ file: "src/notify.ts", lines: [39, 41] }] }, groundTruth, graph);
    expect(score.tier).toBe("aligned");
  });

  it("bare `line N` forms anchored to a file mention are extracted", () => {
    const score = scoreCitationPrecision("in src/notify.ts the publish call on line 41 precedes the insert", noEvidence, groundTruth, graph);
    expect(score.tier).toBe("aligned");
  });

  it("aligned wins over adjacent when both are cited", () => {
    const score = scoreCitationPrecision("src/api.ts:3 calls into src/notify.ts:40", noEvidence, groundTruth, graph);
    expect(score.tier).toBe("aligned");
  });
});

describe("the scorer makes zero model calls", () => {
  beforeEach(() => {
    // Any model/network use inside the scoring pass would explode loudly.
    vi.stubGlobal("fetch", () => {
      throw new Error("the citation scorer must never reach a model");
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a full scoring pass over every seeded-bad fixture is synchronous and model-free", () => {
    const manifest = buildSeededManifest();
    expect(manifest.success).toBe(true);
    if (!manifest.success) return;

    const seeded = manifest.value.fixtures.filter((f) => f.ground_truth_defect_loc);
    expect(seeded.length).toBeGreaterThanOrEqual(50);
    for (const f of seeded) {
      const loc = f.ground_truth_defect_loc!;
      const score = scoreCitationPrecision(
        `the defect is at ${loc.file}:${loc.line}`,
        noEvidence,
        loc,
        { imports: () => [], importedBy: () => [] },
      );
      expect(score.tier).toBe("aligned");
    }
  });
});
