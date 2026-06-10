import { statSync } from "node:fs";

import { createTempRepo, readTraces, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { emptyBeadMemory, type VerifierSignal } from "./beadMemory.js";
import { serializeBeadMemory } from "./beadMemory.js";
import { compact } from "./compact.js";
import { writeBackMemory } from "./materialize.js";

// Task 3.4 / P2-T2 (size-bound half) — a simulated 20-iter short cycle writing
// back each iteration holds memory size near the iter-3 baseline (zero-model).

// The bead retries one structural approach (the §3.4.1 livelock shape): the
// rolling summary plateaus at a single merged entry while iters grow 1→20.
const LABELS = ["mock-call-order"] as const;

function signal(iter: number): VerifierSignal {
  return {
    iter,
    decision: "reject",
    triple_id: 'notifications/send/unit-tests[covers-persist-first] "suite include ordering"',
    polarity: "positive",
    focal_verdict: "fail",
    support_quality: "ok",
    slot_focus: "predicate",
    approach_label: LABELS[iter % LABELS.length],
    channel: "test-authoring",
    evidence_quote: `iter-${iter} excerpt of the failing assertion`,
    rationale: `verbose rationale for iter ${iter} that compaction must drop`,
  };
}

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
});
afterEach(() => repo.cleanup());

describe("20-iteration size bound", () => {
  test("size(iter 20) ≈ size(iter 3) within ±15%, with no model call during write-back", () => {
    let memory = emptyBeadMemory("bd_1", "engineer");
    // Constant context present from iter 1 (the bead's scope + touched files).
    memory = {
      ...memory,
      intent_set_in_scope: [
        "notifications/send [persist-first, publish-sync-per-insert, respect-opt-out]",
        "notifications/send/unit-tests [covers-persist-first, covers-publish-per-insert]",
      ],
      files_being_modified: [
        "packages/api/src/services/notifications/index.ts",
        "packages/api/src/services/notifications/index.test.ts",
      ],
    };
    const sizes: Record<number, number> = {};

    for (let iter = 1; iter <= 20; iter++) {
      memory = { ...memory, last_iter: iter, verifier_signals: [...memory.verifier_signals, signal(iter)] };
      memory = compact(memory);
      const path = writeBackMemory({
        rootDir: repo.dir,
        scope: "bead",
        role: "engineer",
        ids: { beadId: "bd_1" },
        content: serializeBeadMemory(memory),
      });
      sizes[iter] = statSync(path!).size;
    }

    const ratio = sizes[20] / sizes[3];
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);

    // mechanical compaction performs no model call → no trace stream written.
    expect(readTraces(repo.dir)).toHaveLength(0);
  });
});
