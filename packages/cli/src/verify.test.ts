import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { stringify as stringifyYaml } from "yaml";
import { execFileSync } from "node:child_process";
import { cleanSourcePath, WORKED_EXAMPLE_FILE, workedExampleIntents } from "@dusk/fixtures";
import { createTempRepo, type TempRepo } from "@dusk/test-harness";
import { claudeCodeAvailable, type ModelClient } from "@dusk/runtime-verifier";
import type { Verdict } from "@dusk/core-schema";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { renderVerdicts, runVerify } from "./verify.js";
import { scaffoldProject } from "./scaffold.js";

// Task 7.1 — `dusk verify` renders per-triple verdicts; real-model e2e is gated on the claude CLI.

const RUN_CORRECTNESS = Boolean(process.env.DUSK_RUN_CORRECTNESS) && claudeCodeAvailable();
const fakeModel: ModelClient = {
  complete: async () => ({
    text: JSON.stringify({ triples: [] }),
    usage: { model: "fake", promptTokens: 1, completionTokens: 1, costUsd: 0, latencyMs: 0 },
  }),
};

describe("renderVerdicts", () => {
  test("renders per-triple focal/support/polarity lines and the implies note", () => {
    const verdicts: Verdict[] = [
      {
        intent_path: "notifications/send",
        decision: "reject",
        per_triple: [
          { triple_id: "persist-first", focal_verdict: "fail", support_quality: "ok", polarity: "positive", evidence: { support_claims: [] }, rationale: "" },
        ],
        aggregate_rationale: "",
      },
      { intent_path: "api/idempotency-on-writes", decision: "accept", implies_antecedent_held: false, per_triple: [], aggregate_rationale: "" },
    ];
    const text = renderVerdicts(verdicts);
    expect(text).toContain("REJECT  notifications/send");
    expect(text).toContain("[persist-first] focal=fail");
    expect(text).toContain("antecedent did not hold");
  });
});

describe("7.1 — dusk verify on the worked example (real model)", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = createTempRepo({ git: true });
    scaffoldProject(repo.dir);
    // worked-example source on disk
    const dest = join(repo.dir, WORKED_EXAMPLE_FILE);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(cleanSourcePath(), dest);
    // intents on disk
    for (const intent of workedExampleIntents().values()) {
      repo.write(`.ia/intents/${intent.id}/intent.yaml`, stringifyYaml(intent));
    }
  });
  afterEach(() => repo.cleanup());

  test.skipIf(!RUN_CORRECTNESS)("prints per-triple verdicts via the ambient Claude Code model; tree unchanged", async () => {
    const before = execFileSync("git", ["status", "--porcelain"], { cwd: repo.dir }).toString();
    const result = await runVerify(repo.dir, WORKED_EXAMPLE_FILE, { model: process.env.DUSK_VERIFIER_MODEL });
    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/ACCEPT|REJECT/);
    const after = execFileSync("git", ["status", "--porcelain"], { cwd: repo.dir }).toString();
    expect(after).toBe(before);
  }, 300_000);

  test("with an injected model, renders verdicts and leaves the working tree unchanged (deterministic)", async () => {
    const before = execFileSync("git", ["status", "--porcelain"], { cwd: repo.dir }).toString();
    const result = await runVerify(repo.dir, WORKED_EXAMPLE_FILE, { modelClient: fakeModel });
    expect(result.ok).toBe(true);
    const after = execFileSync("git", ["status", "--porcelain"], { cwd: repo.dir }).toString();
    expect(after).toBe(before);
  });
});
