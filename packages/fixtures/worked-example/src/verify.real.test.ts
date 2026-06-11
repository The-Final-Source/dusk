import { isTransportError } from "@dusk/test-harness";
import {
  claudeCodeAvailable,
  claudeCodeModelClient,
  verifyIntent,
  type VerifyDeps,
} from "@dusk/runtime-verifier";
import type { Verdict } from "@dusk/core-schema";
import { describe, expect, it } from "vitest";

import { loadWorkedExample } from "./index.js";

/**
 * P5-T10 leg (b) — the standing `dusk verify` regression against the REAL
 * frontier model (temperature 0, ambient Claude Code CLI). Correctness-gated
 * per the Phase 2–4 convention (N=3, pass ≥2/3) with the pre-registered
 * transport-failure amendment: transport errors are null observations
 * consuming the retry; two transport deaths fail the leg; assertion failures
 * never classify as transport noise.
 */
const RUN_CORRECTNESS = Boolean(process.env.DUSK_RUN_CORRECTNESS) && claudeCodeAvailable();
const MODEL = process.env.DUSK_VERIFIER_MODEL ?? "claude-sonnet-4-6";
const N = 3;
const THRESHOLD = 2;
const TIMEOUT = 30 * 60 * 1000;

async function observe<T>(leg: () => Promise<T>): Promise<T> {
  try {
    return await leg();
  } catch (first) {
    if (!isTransportError(first)) throw first;
    return await leg(); // one retry; a second transport death fails the leg
  }
}

describe.skipIf(!RUN_CORRECTNESS)("P5-T10 — the worked example verifies clean (standing regression)", () => {
  it(
    "every focal verdict passes, including the negative-polarity triple and the implies intent's documented outcome",
    async () => {
      const example = loadWorkedExample();
      const deps: VerifyDeps = {
        index: example.index,
        readFile: example.readFile,
        maxLines: 200,
        modelClient: claudeCodeModelClient({ model: MODEL }),
      };

      for (const intentId of ["notifications/send", "db/use-drizzle-orm", "api/idempotency-on-writes"]) {
        const intent = example.intents.get(intentId)!;
        const verdicts: Verdict[] = [];
        for (let i = 0; i < N; i += 1) {
          const result = await observe(() => verifyIntent(intent, deps));
          if (result.success) verdicts.push(result.value);
        }
        const accepts = verdicts.filter((v) => v.decision === "accept").length;
        expect(accepts, `${intentId} regressed: ${verdicts.map((v) => v.aggregate_rationale).join(" | ")}`).toBeGreaterThanOrEqual(THRESHOLD);

        if (intentId === "api/idempotency-on-writes") {
          // The implies intent's documented outcome: the antecedent does not
          // hold on the worked example, so the consequent is vacuously accepted.
          expect(verdicts.every((v) => v.implies_antecedent_held === false)).toBe(true);
        }
        if (intentId === "db/use-drizzle-orm") {
          // The negative-polarity triple passes (the forbidden pattern is absent).
          for (const v of verdicts) {
            const noRawSql = v.per_triple.find((t) => t.triple_id === "no-raw-sql");
            if (noRawSql) expect(noRawSql.focal_verdict).toBe("pass");
          }
        }
      }
    },
    TIMEOUT,
  );
});
