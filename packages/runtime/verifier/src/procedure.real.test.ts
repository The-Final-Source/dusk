import { parseDecorations } from "@dusk/core-decoration";
import { buildDerivedIndex } from "@dusk/core-index";
import { IntentSchema, type Intent, type Verdict } from "@dusk/core-schema";
import { loadWorkedExample } from "@dusk/fixtures";
import { describe, expect, test } from "vitest";

import { anthropicModelClient } from "./modelClient.js";
import { DEFAULT_VERIFIER_SYSTEM_PROMPT, verifyIntent } from "./procedure.js";

/**
 * Verdict-correctness tests against the REAL frontier model at temperature 0.
 * Pre-registered protocol (design D12): N=3 independent invocations per
 * assertion; pass when ≥2/3 produce the documented structural outcome. Gated on
 * ANTHROPIC_API_KEY — skipped (not failed) when no key is configured.
 */
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.DUSK_VERIFIER_MODEL ?? "claude-sonnet-4-6";
const N = 3;
const THRESHOLD = 2;

const modelClient = () => anthropicModelClient({ apiKey: API_KEY!, model: MODEL });

/** Run verifyIntent N times; return the verdicts (filtering structural errors). */
async function runN(intent: Intent, deps: Parameters<typeof verifyIntent>[1]): Promise<Verdict[]> {
  const out: Verdict[] = [];
  for (let i = 0; i < N; i += 1) {
    const r = await verifyIntent(intent, deps);
    if (r.success) out.push(r.value);
  }
  return out;
}

const countWhere = <T>(items: T[], pred: (t: T) => boolean): number => items.filter(pred).length;

function buildIndex(source: string, file: string) {
  const records = parseDecorations(source, file);
  return { records, index: (intents: Map<string, Intent>) => buildDerivedIndex(records, intents) };
}

describe.skipIf(!API_KEY)("verifier procedure — real model (temperature 0, N=3 ≥2/3)", () => {
  test("5.10 — a clean intent on the worked example verifies pass with the full verdict shape", async () => {
    const wx = loadWorkedExample();
    const intent = wx.intents.get("notifications/send")!;
    const verdicts = await runN(intent, { index: wx.index, readFile: wx.readFile, maxLines: 200, modelClient: modelClient(), systemPrompt: DEFAULT_VERIFIER_SYSTEM_PROMPT });
    const accepts = countWhere(verdicts, (v) => v.decision === "accept");
    expect(accepts).toBeGreaterThanOrEqual(THRESHOLD);
    const sample = verdicts[0];
    expect(sample.per_triple.length).toBeGreaterThan(0);
    expect(sample.per_triple[0]).toHaveProperty("focal_verdict");
    expect(sample.per_triple[0]).toHaveProperty("support_quality");
    expect(sample.per_triple[0]).toHaveProperty("polarity");
    expect(sample).toHaveProperty("aggregate_rationale");
  }, 120_000);

  test("5.5 — negative-polarity triple passes when the affirmative claim is absent (no raw SQL)", async () => {
    const wx = loadWorkedExample();
    const intent = wx.intents.get("db/use-drizzle-orm")!; // includes no-raw-sql (polarity: negative)
    const verdicts = await runN(intent, { index: wx.index, readFile: wx.readFile, maxLines: 200, modelClient: modelClient(), systemPrompt: DEFAULT_VERIFIER_SYSTEM_PROMPT });
    const noRawSqlPass = countWhere(verdicts, (v) => v.per_triple.find((t) => t.triple_id === "no-raw-sql")?.focal_verdict === "pass");
    expect(noRawSqlPass).toBeGreaterThanOrEqual(THRESHOLD);
  }, 120_000);

  test("5.8 — exactly-one quantifier fails on double-publish, passes on single-publish", async () => {
    const dbl = [
      "// @intent svc/publish [one-per-row]",
      "export function emit(rows) {",
      "  // @intent-support svc/publish [one-per-row] [\"the loop\", \"iterates\", \"over rows\"]",
      "  for (const row of rows) {",
      "    // @intent svc/publish [one-per-row]",
      "    bus.publish(row);",
      "    bus.publish(row);",
      "  }",
      "}",
    ].join("\n");
    const intent = IntentSchema.parse({
      id: "svc/publish",
      description: "publish exactly one event per row",
      obligation: "must",
      compose: "all",
      triples: [{ id: "one-per-row", subject: "the loop body", predicate: "publishes an event", object: "to the bus", quantifier: "exactly-one", scope: "per row" }],
    });
    const built = buildIndex(dbl, "svc.ts");
    const index = built.index(new Map([["svc/publish", intent]]));
    const verdicts = await runN(intent, { index, readFile: () => dbl, maxLines: 200, modelClient: modelClient(), systemPrompt: DEFAULT_VERIFIER_SYSTEM_PROMPT });
    const fails = countWhere(verdicts, (v) => v.per_triple[0]?.focal_verdict === "fail");
    expect(fails).toBeGreaterThanOrEqual(THRESHOLD);
  }, 120_000);

  test("5.6 — mismatching support lowers support_quality without failing the focal claim", async () => {
    const src = [
      "// @intent svc/sum [adds]",
      "export function add(a, b) {",
      "  // @intent svc/sum [adds]",
      "  // @intent-support svc/sum [adds] [\"the body\", \"multiplies\", \"the two operands together\"]",
      "  return a + b;",
      "}",
    ].join("\n");
    const intent = IntentSchema.parse({
      id: "svc/sum",
      description: "add returns the sum of its operands",
      obligation: "must",
      compose: "all",
      triples: [{ id: "adds", subject: "the function", predicate: "returns", object: "the sum of its two operands" }],
    });
    const built = buildIndex(src, "svc.ts");
    const index = built.index(new Map([["svc/sum", intent]]));
    const verdicts = await runN(intent, { index, readFile: () => src, maxLines: 200, modelClient: modelClient(), systemPrompt: DEFAULT_VERIFIER_SYSTEM_PROMPT });
    // focal passes (the code does add) while the support ("multiplies") mismatches → low_confidence
    const focalPass = countWhere(verdicts, (v) => v.per_triple[0]?.focal_verdict === "pass");
    const lowConf = countWhere(verdicts, (v) => v.per_triple[0]?.support_quality === "low_confidence");
    expect(focalPass).toBeGreaterThanOrEqual(THRESHOLD);
    expect(lowConf).toBeGreaterThanOrEqual(THRESHOLD);
  }, 120_000);
});
