import { describe, expect, it } from "vitest";

import { classifyBoundary } from "./boundaryOutcome.js";
import { TransportLegFailure } from "./transportRetry.js";

describe("classifyBoundary (the one classifier gate — RFC App. D.34, R2)", () => {
  it("resolves a complete, parsed, non-timed-out boundary to content", () => {
    expect(classifyBoundary({ parsedToDuskSchema: true, completenessHeld: true })).toEqual({ kind: "content" });
  });

  it("resolves Dusk's own timeout firing to no_verdict (tool_infrastructure) — a universal liveness fact", () => {
    expect(classifyBoundary({ timedOut: true })).toEqual({ kind: "no_verdict", reason: "tool_infrastructure" });
  });

  it("resolves bytes that did not parse into Dusk's schema to no_verdict (unparseable)", () => {
    expect(classifyBoundary({ parsedToDuskSchema: false })).toEqual({ kind: "no_verdict", reason: "unparseable" });
  });

  it("resolves a failed positive-completeness check to no_verdict (incomplete) — never inferred content (R8)", () => {
    expect(classifyBoundary({ parsedToDuskSchema: true, completenessHeld: false })).toEqual({
      kind: "no_verdict",
      reason: "incomplete",
    });
  });

  it("classifies a two-death TransportLegFailure as no_verdict (tool_infrastructure)", () => {
    const outcome = classifyBoundary({ error: new TransportLegFailure(new Error("a"), new Error("b")) });
    expect(outcome).toEqual({ kind: "no_verdict", reason: "tool_infrastructure" });
  });

  it("classifies a deterministic-limit (duskModelExit-tagged) error as no_verdict (deterministic_limit) — never cold-retried", () => {
    const err = Object.assign(new Error("claude CLI exited 1"), { duskModelExit: "error_max_turns" });
    expect(classifyBoundary({ error: err })).toEqual({ kind: "no_verdict", reason: "deterministic_limit" });
  });

  it("classifies a single genuine transport error as transport (eligible for the one retry)", () => {
    expect(classifyBoundary({ error: new Error("claude CLI timed out") })).toEqual({ kind: "transport" });
  });
});
