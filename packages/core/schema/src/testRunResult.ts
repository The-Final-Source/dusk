import { z } from "zod";

import { type BoundaryOutcome } from "./boundaryOutcome.js";

/**
 * Dusk's OWN test-result schema (RFC App. D.34, decision ①) — the mechanical
 * floor for Stage-2 that does NOT re-couple to a toolchain. Mirroring how the
 * project's *code* is decorated to map onto Dusk's *intent* schema, the project's
 * *test command* emits results in THIS schema via a thin project-side
 * adapter/reporter (a vitest reporter, a pytest plugin — the project's tech
 * surface, configured in the foundation intent; a Phase-VI/project task, NOT part
 * of the dusk change). The Test Runner core reads ONLY this schema — it is the
 * one tool-shaped thing the core may read because it is Dusk's own (R4/R5).
 *
 * `completed` is the ran-to-completion assertion: a partial/streamed result file
 * SIGKILLed at OOM can leave a schema-valid `failed: 0` while the failing tests
 * were never written. The floor therefore NEVER reads `failed: 0` as `pass`
 * unless `completed` is true — a `failed: 0 ∧ completed: false` is `no_verdict`,
 * never a silent green (R7/R11).
 */

export const DUSK_TEST_OUTCOMES = ["passed", "failed", "not_run"] as const;
export const DuskTestOutcomeSchema = z.enum(DUSK_TEST_OUTCOMES);
export type DuskTestOutcome = z.infer<typeof DuskTestOutcomeSchema>;

export const DuskTestCaseSchema = z
  .object({
    name: z.string(),
    // Dusk's OWN outcome vocabulary — NOT a toolchain's. Three states so a
    // non-run (skipped/todo/pending) is distinguishable from pass/fail (a non-run
    // is never coerced to `failed` — kills the `status!=="passed" ⇒ fail` smell).
    outcome: DuskTestOutcomeSchema,
    duration_ms: z.number().min(0).default(0),
  })
  .strict();
export type DuskTestCase = z.infer<typeof DuskTestCaseSchema>;

export const DuskTestRunResultSchema = z
  .object({
    schema_version: z.literal(1),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    not_run: z.number().int().min(0),
    /** The ran-to-completion assertion — false if the run was truncated/killed mid-flight. */
    completed: z.boolean(),
    cases: z.array(DuskTestCaseSchema),
  })
  .strict();
export type DuskTestRunResult = z.infer<typeof DuskTestRunResultSchema>;

/**
 * The mechanical floor (R4/R5/R11) — zero-model, fully regression-testable. Reads
 * Dusk's own result schema from raw stdout and resolves the Stage-2 boundary:
 *   - `failed > 0`                      → content `fail`
 *   - `passed > 0 ∧ failed == 0 ∧ completed` → content `pass`
 *   - schema absent / unparseable       → `no_verdict` (unparseable)
 *   - `completed == false`              → `no_verdict` (tool_infrastructure) — never `pass`
 *   - only non-run (no pass, no fail)   → `no_verdict` (incomplete)
 * The caller supplies its own liveness fact (`timedOut`) which forces `no_verdict`
 * regardless of a present schema. The agentic bridge is consulted ONLY when this
 * returns `no_verdict` from a schema-absent/unparseable case — and it can push
 * only toward `no_verdict`/`fail`, never manufacture a `pass`.
 */
export function readDuskTestResult(stdout: string, opts: { timedOut?: boolean } = {}):
  | { outcome: "pass" | "fail"; result: DuskTestRunResult }
  | { outcome: "no_verdict"; boundary: Extract<BoundaryOutcome, { kind: "no_verdict" }> } {
  if (opts.timedOut) return { outcome: "no_verdict", boundary: { kind: "no_verdict", reason: "tool_infrastructure" } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { outcome: "no_verdict", boundary: { kind: "no_verdict", reason: "unparseable" } };
  }
  const candidate = DuskTestRunResultSchema.safeParse(parsed);
  if (!candidate.success) return { outcome: "no_verdict", boundary: { kind: "no_verdict", reason: "unparseable" } };

  const result = candidate.data;
  if (!result.completed) return { outcome: "no_verdict", boundary: { kind: "no_verdict", reason: "tool_infrastructure" } };
  if (result.failed > 0) return { outcome: "fail", result };
  if (result.passed > 0) return { outcome: "pass", result };
  // No pass and no fail (only non-run, or an empty suite) — neither a green nor a
  // content fail. Never a silent pass (R7).
  return { outcome: "no_verdict", boundary: { kind: "no_verdict", reason: "incomplete" } };
}
