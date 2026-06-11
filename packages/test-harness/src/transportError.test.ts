import { describe, expect, test } from "vitest";

import { isTransportError } from "./transportError.js";

/**
 * The transport classifier gates what the real-model N-protocol may retry and
 * consume (arch-board D4 + S7). It must match the model client's actual throw
 * sites and NOTHING else — assertion failures and bugs must classify false.
 */

describe("isTransportError", () => {
  test("matches the claudeCodeModelClient throw sites", () => {
    expect(isTransportError(new Error("claude CLI timed out"))).toBe(true);
    expect(isTransportError(new Error("claude CLI exited 1: "))).toBe(true);
    expect(isTransportError(new Error("claude CLI exited 137: killed"))).toBe(true);
    const spawnError = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    expect(isTransportError(spawnError)).toBe(true);
    const pipeError = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    expect(isTransportError(pipeError)).toBe(true);
    // Malformed --output-format json envelope.
    expect(isTransportError(new SyntaxError("Unexpected token < in JSON at position 0"))).toBe(true);
  });

  test("never classifies assertion failures or programming bugs as transport", () => {
    const assertion = Object.assign(new Error("expected 1 to be 2"), { name: "AssertionError" });
    expect(isTransportError(assertion)).toBe(false);
    expect(isTransportError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isTransportError(new Error("scripted author script underran (had 3 responses)"))).toBe(false);
    expect(isTransportError("not even an Error")).toBe(false);
    expect(isTransportError(undefined)).toBe(false);
  });
});
