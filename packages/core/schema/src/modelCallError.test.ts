import { describe, expect, test } from "vitest";

import { isModelCallFailure, isTransportError } from "./modelCallError.js";

/**
 * Failure classification is the single source of truth for what the real-model
 * legs may retry and what the spawn seam must SURFACE (RFC App. D.33). It must
 * match the model client's actual throw sites and NOTHING else — a deterministic
 * content/limit failure is NOT transport (must not be cold-retried); a
 * programming bug is NEITHER (must propagate loud).
 */

const errorMaxTurnsEnvelope = `{"type":"result","subtype":"error_max_turns","num_turns":4,"stop_reason":"tool_use"}`;

/** The error the (fixed) `runClaude` throws on an `error_max_turns` exit. */
function taggedErrorMaxTurns(): Error {
  return Object.assign(new Error(`claude CLI exited 1:  ${errorMaxTurnsEnvelope}`), { duskModelExit: "error_max_turns" });
}

describe("isTransportError", () => {
  test("matches genuine plumbing throw sites", () => {
    expect(isTransportError(new Error("claude CLI timed out"))).toBe(true);
    expect(isTransportError(new Error("claude CLI exited 1: "))).toBe(true);
    expect(isTransportError(new Error("claude CLI exited 137: killed"))).toBe(true);
    expect(isTransportError(Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }))).toBe(true);
    expect(isTransportError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))).toBe(true);
    expect(isTransportError(new SyntaxError("Unexpected token < in JSON at position 0"))).toBe(true);
  });

  test("a content/limit-shaped error_max_turns is NOT transport (D.33 — never cold-retried)", () => {
    expect(isTransportError(taggedErrorMaxTurns())).toBe(false);
  });

  test("never classifies assertion failures or programming bugs as transport", () => {
    expect(isTransportError(Object.assign(new Error("expected 1 to be 2"), { name: "AssertionError" }))).toBe(false);
    expect(isTransportError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isTransportError("not even an Error")).toBe(false);
    expect(isTransportError(undefined)).toBe(false);
  });
});

describe("isModelCallFailure (the spawn-seam surface-vs-rethrow predicate)", () => {
  test("a tagged content/limit failure is a model-call failure (surface it)", () => {
    expect(isModelCallFailure(taggedErrorMaxTurns())).toBe(true);
  });

  test("a two-death TransportLegFailure is a model-call failure, matched by name (no import)", () => {
    const legFailure = Object.assign(new Error("transport leg failure: two transport-classified deaths"), { name: "TransportLegFailure" });
    expect(isModelCallFailure(legFailure)).toBe(true);
  });

  test("a genuine transport error is a model-call failure (defensive arm)", () => {
    expect(isModelCallFailure(new Error("claude CLI timed out"))).toBe(true);
  });

  test("a programming bug is NOT a model-call failure (must propagate loud — the honesty bar)", () => {
    expect(isModelCallFailure(new TypeError("boom"))).toBe(false);
    expect(isModelCallFailure(Object.assign(new Error("expected 1 to be 2"), { name: "AssertionError" }))).toBe(false);
    expect(isModelCallFailure("not even an Error")).toBe(false);
  });
});
