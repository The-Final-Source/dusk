import { readFileSync } from "node:fs";

import { parseDecorations } from "@dusk/core-decoration";
import { buildDerivedIndex } from "@dusk/core-index";
import { loadIntentTree } from "@dusk/core-graph";
import type { Verdict } from "@dusk/core-schema";
import { DEFAULT_VERIFIER_SYSTEM_PROMPT, claudeCodeAvailable, claudeCodeModelClient, verifyIntent } from "@dusk/runtime-verifier";
import { stucknessFiredAt } from "@dusk/runtime-short-cycle";
import { createTempRepo, writeStallingFixture } from "@dusk/test-harness";
import { describe, expect, test } from "vitest";

/**
 * P3-T8 integration leg (6.4): derive `failing_triple_set` from REAL (temperature
 * 0) Verifier verdicts on a genuinely-stalling fixture, and prove the stuckness
 * predicate fires when the upstream signal genuinely matches — i.e. the
 * derivation is wired, not just the predicate. Gated on the Claude Code CLI (the
 * Verifier runs on the ambient model, no API key); skipped under the default
 * deterministic suite (pre-registered protocol: N=3, threshold ≥2/3).
 */
const RUN_CORRECTNESS = Boolean(process.env.DUSK_RUN_CORRECTNESS) && claudeCodeAvailable();
const MODEL = process.env.DUSK_VERIFIER_MODEL ?? "claude-sonnet-4-6";
const N = 3;

const failingTripleSet = (v: Verdict): string[] => v.per_triple.filter((t) => t.focal_verdict === "fail").map((t) => t.triple_id).sort();

describe.skipIf(!RUN_CORRECTNESS)("6.4 / P3-T8 — stuckness derivation against real verdicts on a stalling fixture", () => {
  test("real Verifier verdicts feed failing_triple_set; the detector fires when the signal is stable", async () => {
    const repo = createTempRepo({ git: false });
    try {
      const fixture = writeStallingFixture(repo.dir);
      const records = parseDecorations(readFileSync(fixture.sourceFile, "utf8"), "src/stall.ts");
      const tree = loadIntentTree(`${repo.dir}/.ia/intents`);
      const index = buildDerivedIndex(records, tree.intents);
      const intent = tree.intents.get(fixture.intentPath)!;
      const modelClient = claudeCodeModelClient({ model: MODEL });

      const sets: string[][] = [];
      for (let i = 0; i < N; i += 1) {
        const r = await verifyIntent(intent, { index, readFile: () => readFileSync(fixture.sourceFile, "utf8"), maxLines: 200, modelClient, systemPrompt: DEFAULT_VERIFIER_SYSTEM_PROMPT });
        if (r.success) sets.push(failingTripleSet(r.value));
      }

      // ≥2/3 runs produce the SAME non-empty failing-triple set (the contradiction is stable).
      const tally = new Map<string, number>();
      for (const s of sets) tally.set(s.join("|"), (tally.get(s.join("|")) ?? 0) + 1);
      const [dominant, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
      expect(count).toBeGreaterThanOrEqual(2);
      expect(dominant.length).toBeGreaterThan(0); // non-empty failing set

      // Fed three identical real-derived sets, the predicate fires.
      const stable = dominant.split("|");
      expect(stucknessFiredAt([stable, stable, stable])).toBe(true);
    } finally {
      repo.cleanup();
    }
  });
});
