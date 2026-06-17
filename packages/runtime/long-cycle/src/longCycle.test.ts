import { buildDerivedIndex, type DerivedIndex } from "@dusk/core-index";
import type { DecorationRecord } from "@dusk/core-decoration";
import { duskError, ok, type BoundSpawn, type Intent, type SubAgentTrace, type Verdict } from "@dusk/core-schema";
import { describe, expect, test } from "vitest";

import { runLongCycle } from "./longCycle.js";
import { affectedUniverse, type ImportGraph, type Tuple } from "./universe.js";

// §8 long-cycle — zero-model (hand-rolled spawn stub).

const intent = (id: string): Intent => ({ schema_version: 2, id, description: id, obligation: "must", compose: "all", triples: [{ id: "t1", subject: "s", predicate: "p", object: "o", polarity: "positive" }], relates_to: [] });
const rec = (file: string, intentPath: string): DecorationRecord => ({ file, line: 1, scope: "declaration", declaration_name: "x", marker: "intent", intent_path: intentPath, aspect_ids: ["t1"], support_triple: null, ignore_clause: null });

describe("8.1 — affected universe is direct ∪ 1-hop adjacent, snapshot-only (P3-T26)", () => {
  test("universe = claims in F (direct) + G (imports) + H (imported-by); excludes 2-hop + delta", () => {
    const intents = new Map<string, Intent>([
      ["api/f", intent("api/f")],
      ["api/g", intent("api/g")],
      ["api/h", intent("api/h")],
      ["api/j", intent("api/j")],
    ]);
    // Snapshot records. Note: api/new on F is the bead's in-flight delta → NOT in the snapshot.
    const index = buildDerivedIndex(
      [rec("F.ts", "api/f"), rec("G.ts", "api/g"), rec("H.ts", "api/h"), rec("J.ts", "api/j")],
      intents,
    );
    const graph: ImportGraph = {
      imports: (f) => (f === "F.ts" ? ["G.ts"] : f === "G.ts" ? ["J.ts"] : []),
      importedBy: (f) => (f === "F.ts" ? ["H.ts"] : []),
    };

    const universe = affectedUniverse(["F.ts"], index, graph);
    const intents_in = universe.map((t) => t.intent_path).sort();
    expect(intents_in).toEqual(["api/f", "api/g", "api/h"]);
    expect(intents_in).not.toContain("api/j"); // 2-hop (imported by G) excluded
    expect(universe.find((t) => t.intent_path === "api/new")).toBeUndefined(); // delta excluded (not in snapshot)
  });
});

// ---- spawn stub for the sampling/confirmation driver -----------------------

type Stub = { spawn: BoundSpawn; confirmationTraceIds: () => (string | undefined)[]; verifierCount: () => number };

function makeStub(verdicts: Verdict[]): Stub {
  let i = 0;
  let ctr = 0;
  const confirmationTraceIds: (string | undefined)[] = [];
  let verifierCount = 0;
  const spawn: BoundSpawn = async (params) => {
    ctr += 1;
    const trace: SubAgentTrace = {
      schema_version: 1,
      trace_id: `tr_${ctr}`,
      role: params.role,
      invocation_site: params.invocationSite ?? "implement",
      model: "stub",
      prompt_tokens: 0,
      completion_tokens: 0,
      latency_ms: 0,
      cost_usd: 0,
      ...(params.beadLifecycle?.confirmation_of_trace_id ? { confirmation_of_trace_id: params.beadLifecycle.confirmation_of_trace_id } : {}),
    };
    if (params.role === "verifier") {
      verifierCount += 1;
      confirmationTraceIds.push(params.beadLifecycle?.confirmation_of_trace_id);
      return ok({ trace, assembledPrompt: params.input, verdict: verdicts[i++] });
    }
    return ok({ trace, assembledPrompt: params.input, output: "ok" });
  };
  return { spawn, confirmationTraceIds: () => confirmationTraceIds, verifierCount: () => verifierCount };
}

const accept = (intentPath: string): Verdict => ({ intent_path: intentPath, decision: "accept", per_triple: [], aggregate_rationale: "ok" });
const reject = (intentPath: string): Verdict => ({ intent_path: intentPath, decision: "reject", per_triple: [], aggregate_rationale: "regressed" });

const tuples = (n: number): Tuple[] => Array.from({ length: n }, (_, k) => ({ intent_path: `api/u${k}`, claimant: `f${k}.ts` }));
const base = (stub: Stub, universe: Tuple[]) => ({ spawn: stub.spawn, beadId: "bd_1", sessionId: "s1", universe, verifierInputFor: (t: Tuple) => `verify ${t.intent_path}` });

describe("8.2 — N=10 shuffle sharding + early stop (P3-T13)", () => {
  test("≥10-tuple universe samples exactly 10 verdicts and is clean", async () => {
    const stub = makeStub(Array.from({ length: 12 }, (_, k) => accept(`api/u${k}`)));
    const result = await runLongCycle(base(stub, tuples(12)));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.kind).toBe("clean");
    if (result.value.kind !== "clean") return;
    expect(result.value.sampledVerdicts).toBe(10);
  });

  test("small (4-tuple) universe causes early stop at 4", async () => {
    const stub = makeStub(Array.from({ length: 4 }, (_, k) => accept(`api/u${k}`)));
    const result = await runLongCycle(base(stub, tuples(4)));
    expect(result.success && result.value.kind === "clean" && result.value.sampledVerdicts).toBe(4);
  });
});

describe("8.3 — N=2 confirmation pass on first reject (P3-T14/T15)", () => {
  test("[reject, reject, accept] → confirmed_reject; 2 confirmation spawns share confirmation_of_trace_id", async () => {
    const u = tuples(3);
    // original reject (u0), conf1 reject, conf2 accept.
    const stub = makeStub([reject("api/u0"), reject("api/u0"), accept("api/u0")]);
    const result = await runLongCycle(base(stub, u));
    expect(result.success).toBe(true);
    if (!result.success || result.value.kind !== "confirmed_reject") return;
    expect(result.value.regressedIntent).toBe("api/u0");
    // 2 confirmation spawns share the original's trace id.
    const confIds = stub.confirmationTraceIds().filter(Boolean);
    expect(confIds).toHaveLength(2);
    expect(new Set(confIds).size).toBe(1);
    expect(confIds[0]).toBe(result.value.confirmationTraceId);
  });

  test("[reject, accept, accept] → flaky_verdict_dismissed → continues clean", async () => {
    const u = tuples(3);
    // u0: original reject; conf1 accept; conf2 accept → dismissed. u1, u2 accept → clean.
    const stub = makeStub([reject("api/u0"), accept("api/u0"), accept("api/u0"), accept("api/u1"), accept("api/u2")]);
    const result = await runLongCycle(base(stub, u));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.kind).toBe("clean"); // dismissed, did NOT re-enter Step 4
  });

  // RFC App. D.34 / D8 — a no_verdict confirmation is NEITHER a confirming reject
  // NOR a flaky-dismiss; it routes the bead to the infrastructure axis.
  test("[reject, no_verdict, no_verdict] → no_verdict outcome, NOT a flaky dismissal and NOT confirmed_reject", async () => {
    const seq: ("reject" | "noverdict")[] = ["reject", "noverdict", "noverdict"];
    let i = 0;
    let ctr = 0;
    const spawn: BoundSpawn = async (params) => {
      ctr += 1;
      const trace = { schema_version: 1, trace_id: `tr_${ctr}`, role: params.role, invocation_site: params.invocationSite ?? "implement", model: "stub", prompt_tokens: 0, completion_tokens: 0, latency_ms: 0, cost_usd: 0 } as SubAgentTrace;
      if (params.role !== "verifier") return ok({ trace, assembledPrompt: params.input, output: "ok" });
      const kind = seq[i++];
      const verdict =
        kind === "reject"
          ? reject("api/u0")
          : duskError("infrastructure_no_verdict", "degraded long-cycle verifier", { recoverable: true, details: { no_verdict_reason: "empty" } });
      return ok({ trace, assembledPrompt: params.input, verdict });
    };
    const result = await runLongCycle(base({ spawn, confirmationTraceIds: () => [], verifierCount: () => 0 }, tuples(3)));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.kind).toBe("no_verdict"); // never "clean" (flaky-dismiss) and never "confirmed_reject"
  });

  test("a later reject after a dismissed pass does NOT fire a second confirmation pass", async () => {
    const u = tuples(3);
    // u0 reject → conf accept, accept (dismissed); u1 reject (no confirmation pass); u2 accept.
    const stub = makeStub([reject("api/u0"), accept("api/u0"), accept("api/u0"), reject("api/u1"), accept("api/u2")]);
    const result = await runLongCycle(base(stub, u));
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Exactly ONE confirmation pass fired (2 confirmation spawns), not two.
    expect(stub.confirmationTraceIds().filter(Boolean)).toHaveLength(2);
    // The later reject is aggregated directly (confirmed_reject without a 2nd pass).
    expect(result.value.kind).toBe("confirmed_reject");
  });
});
