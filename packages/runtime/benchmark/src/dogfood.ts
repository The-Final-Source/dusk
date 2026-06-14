import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DogfoodReportSchema, dogfoodDir, duskError, err, ok, type DogfoodReport, type RuntimeResult } from "@dusk/core-schema";
import { z } from "zod";

import type { Clock } from "./auditRunner.js";

// `dogfoodDir` is the SSoT layout from `@dusk/core-schema` so the api metrics
// reader resolves the same `dogfood-report.json` this window writer produces.
export { dogfoodDir };

/**
 * Dogfood window data + the go/no-go evaluation — Phase 5 design D8 (P5-T11).
 * Operational data lands in `.ia/observability/dogfood/` as dated JSONL;
 * `dusk benchmark --evaluate-dogfood` is a DETERMINISTIC, re-runnable pure
 * pass over that data. The gating section evaluates EXACTLY the four named
 * thresholds; everything else is exploratory and labeled `gating: false` in
 * the artifact itself. Missing gate data is honest: no data is never a pass.
 */

export const DogfoodEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("window_started"), at: z.string(), package: z.string(), first_decorated_commit: z.string() }).strict(),
  z
    .object({
      kind: z.literal("implement_run"),
      at: z.string(),
      success: z.boolean(),
      commit_sha: z.string().optional(),
      trailers_complete: z.boolean().optional(),
      iterations: z.number().int().min(0).optional(),
      stuckness_fired: z.boolean().optional(),
      livelock: z.boolean().optional(),
      note: z.string().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("gate_event"), at: z.string(), decision: z.enum(["approve", "block"]), false_positive: z.boolean(), note: z.string().optional() }).strict(),
  z.object({ kind: z.literal("doctor_run"), at: z.string(), mode: z.enum(["base", "conservative", "strict-unknowns"]), findings: z.number().int().min(0) }).strict(),
  z.object({ kind: z.literal("worked_example_regression"), at: z.string(), status: z.enum(["clean", "regressed"]) }).strict(),
  z.object({ kind: z.literal("package_test_suite"), at: z.string(), status: z.enum(["green", "red"]) }).strict(),
  z.object({ kind: z.literal("author_dialog"), at: z.string(), branches: z.number().int().min(0) }).strict(),
  z.object({ kind: z.literal("friction"), at: z.string(), observation: z.string(), commit_sha: z.string().optional(), commit_summary: z.string().optional() }).strict(),
  z.object({ kind: z.literal("api_expansion"), at: z.string(), note: z.string() }).strict(),
]);
export type DogfoodEvent = z.infer<typeof DogfoodEventSchema>;

/** Append one window event to the dated JSONL stream. */
export function appendDogfoodEvent(root: string, event: DogfoodEvent): void {
  const validated = DogfoodEventSchema.parse(event);
  const dir = dogfoodDir(root);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${validated.at.slice(0, 10)}.jsonl`), `${JSON.stringify(validated)}\n`, "utf8");
}

export function readDogfoodEvents(root: string): DogfoodEvent[] {
  const dir = dogfoodDir(root);
  if (!existsSync(dir)) return [];
  const events: DogfoodEvent[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (line.trim().length === 0) continue;
      events.push(DogfoodEventSchema.parse(JSON.parse(line)));
    }
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function evaluateDogfood(opts: { root: string; clock: Clock }): RuntimeResult<DogfoodReport> {
  const events = readDogfoodEvents(opts.root);
  const started = events.find((e) => e.kind === "window_started");
  if (!started || started.kind !== "window_started") {
    return err(
      duskError("config_invalid", "no dogfood window has been started (no window_started event in .ia/observability/dogfood/)", {
        recoverable: true,
        recovery_hint: "append a window_started event when the first decorated commit lands",
      }),
    );
  }

  const of = <K extends DogfoodEvent["kind"]>(kind: K) => events.filter((e): e is Extract<DogfoodEvent, { kind: K }> => e.kind === kind);

  // ---- The four named go/no-go thresholds — and ONLY those (D8). ----
  const e2eSuccesses = of("implement_run").filter((e) => e.success && e.commit_sha !== undefined && e.trailers_complete === true);
  const falsePositives = of("gate_event").filter((e) => e.false_positive);
  const regressionEvents = of("worked_example_regression");
  const suiteEvents = of("package_test_suite");
  // No data is never a pass: an unobserved gate fails honestly.
  const regressionValue = regressionEvents.length > 0 && regressionEvents.every((e) => e.status === "clean") ? "clean" : "regressed";
  const suiteValue = suiteEvents.length > 0 && suiteEvents.every((e) => e.status === "green") ? "green" : "red";

  const gating: DogfoodReport["gating"] = {
    e2e_implement_success_count: { value: e2eSuccesses.length, threshold: ">= 1", pass: e2eSuccesses.length >= 1 },
    gate_false_positive_count: { value: falsePositives.length, threshold: "== 0", pass: falsePositives.length === 0 },
    worked_example_regression: { value: regressionValue, threshold: "clean", pass: regressionValue === "clean" },
    package_test_suite: { value: suiteValue, threshold: "green", pass: suiteValue === "green" },
    pass: false,
  };
  gating.pass =
    gating.e2e_implement_success_count.pass &&
    gating.gate_false_positive_count.pass &&
    gating.worked_example_regression.pass &&
    gating.package_test_suite.pass;

  // ---- Exploratory (labeled non-gating in the artifact itself). ----
  const distribution = (values: number[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const v of values) out[String(v)] = (out[String(v)] ?? 0) + 1;
    return out;
  };
  const frictions = of("friction");
  const apiExpansion = of("api_expansion");

  const report: DogfoodReport = {
    schema_version: 1,
    package: started.package,
    window: {
      first_decorated_commit_at: started.at,
      evaluated_at: new Date(opts.clock.now()).toISOString(),
      days: Math.floor((opts.clock.now() - Date.parse(started.at)) / DAY_MS),
    },
    gating,
    exploratory: {
      gating: false,
      iteration_distribution: distribution(of("implement_run").map((e) => e.iterations).filter((n): n is number => n !== undefined)),
      author_branching_distribution: distribution(of("author_dialog").map((e) => e.branches)),
      stuckness_fire_count: of("implement_run").filter((e) => e.stuckness_fired === true).length,
      livelock_count: of("implement_run").filter((e) => e.livelock === true).length,
      doctor_finding_trend: of("doctor_run").map((e) => ({ at: e.at, findings: e.findings })),
      api_expansion: { begun: apiExpansion.length > 0, notes: apiExpansion.map((e) => e.note).join("; ") },
      friction_observations: frictions.map((e) => e.observation),
      friction_commits: frictions
        .filter((e) => e.commit_sha !== undefined)
        .map((e) => ({ sha: e.commit_sha!, summary: e.commit_summary ?? e.observation })),
    },
  };
  return ok(DogfoodReportSchema.parse(report));
}
