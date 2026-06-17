import { isModelCallFailure, isTransportError } from "@dusk/core-schema";
import { describe, expect, test } from "vitest";

import { modelExitSubtype } from "./modelClient.js";

/**
 * The `runClaude` throw site tags a content/limit-shaped CLI exit with the
 * result-envelope subtype, so a deterministic `error_max_turns` is classified
 * non-transport (never cold-retried) and surfaced by the spawn seam rather than
 * crashing the run (RFC App. D.33). `modelExitSubtype` is the zero-model tagger.
 */

describe("modelExitSubtype — tag a content/limit CLI exit from its result envelope", () => {
  test("an error_max_turns envelope yields its subtype", () => {
    const out = `{"type":"result","subtype":"error_max_turns","num_turns":4,"stop_reason":"tool_use","output_tokens":1091}`;
    expect(modelExitSubtype(out)).toBe("error_max_turns");
  });

  test("a sibling error subtype is also tagged (not just error_max_turns by name)", () => {
    expect(modelExitSubtype(`{"type":"result","subtype":"error_during_execution"}`)).toBe("error_during_execution");
  });

  test("a successful (non-error) result envelope is NOT tagged", () => {
    expect(modelExitSubtype(`{"type":"result","subtype":"success","result":"{}"}`)).toBeNull();
  });

  test("a non-JSON / no-envelope stdout (a genuine plumbing failure) is NOT tagged", () => {
    expect(modelExitSubtype("")).toBeNull();
    expect(modelExitSubtype("segfault\n")).toBeNull();
    expect(modelExitSubtype("not json at all")).toBeNull();
  });

  test("end-to-end: the tagged error is non-transport and a surfaced model-call failure (the §8 reproduction)", () => {
    // The error `runClaude` throws on an error_max_turns exit.
    const subtype = modelExitSubtype(`{"type":"result","subtype":"error_max_turns","num_turns":4}`);
    const thrown = Object.assign(new Error(`claude CLI exited 1:  {"subtype":"error_max_turns"}`), { duskModelExit: subtype });
    expect(isTransportError(thrown)).toBe(false); // NOT cold-retried (deterministic)
    expect(isModelCallFailure(thrown)).toBe(true); // surfaced by the spawn seam, not crashed
  });
});
