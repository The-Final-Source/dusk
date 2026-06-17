import { describe, expect, it } from "vitest";

import { readDuskTestResult } from "./testRunResult.js";

const result = (over: Partial<{ passed: number; failed: number; not_run: number; completed: boolean }>): string =>
  JSON.stringify({ schema_version: 1, passed: 0, failed: 0, not_run: 0, completed: true, cases: [], ...over });

describe("readDuskTestResult — the Stage-2 mechanical floor (RFC App. D.34, decision ①; R4/R5/R11)", () => {
  it("failed>0 ⇒ content fail", () => {
    expect(readDuskTestResult(result({ failed: 1, passed: 3 })).outcome).toBe("fail");
  });

  it("passed>0 ∧ failed==0 ∧ completed ⇒ pass", () => {
    expect(readDuskTestResult(result({ passed: 2, failed: 0 })).outcome).toBe("pass");
  });

  it("a truncated zero-failure result (completed:false) ⇒ no_verdict, NEVER pass", () => {
    const r = readDuskTestResult(result({ passed: 5, failed: 0, completed: false }));
    expect(r.outcome).toBe("no_verdict");
    if (r.outcome === "no_verdict") expect(r.boundary.reason).toBe("tool_infrastructure");
  });

  it("only non-run results ⇒ no_verdict (incomplete), not a fabricated fail and not a silent pass", () => {
    const r = readDuskTestResult(result({ passed: 0, failed: 0, not_run: 3 }));
    expect(r.outcome).toBe("no_verdict");
    if (r.outcome === "no_verdict") expect(r.boundary.reason).toBe("incomplete");
  });

  it("absent / unparseable schema ⇒ no_verdict (unparseable)", () => {
    expect(readDuskTestResult("not json at all").outcome).toBe("no_verdict");
    expect(readDuskTestResult(JSON.stringify({ numFailedTests: 0 })).outcome).toBe("no_verdict"); // a tool's vocabulary, not Dusk's schema
  });

  it("Dusk's own timeout firing forces no_verdict regardless of a present schema", () => {
    const r = readDuskTestResult(result({ passed: 2, failed: 0 }), { timedOut: true });
    expect(r.outcome).toBe("no_verdict");
  });
});
