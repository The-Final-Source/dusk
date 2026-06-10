import { describe, expect, test } from "vitest";
import { buildDialogState } from "@dusk/test-harness";

import { classifyUserResponse, pyramidChild, transition } from "./transition.js";

/**
 * 3.1 — the pure transition function in isolation (unit-only; no LLM, no fs).
 * One Stage-1 advance, one Stage-1 loopback, one Stage-2 tension pick, one
 * Stage-4.5 bounce — asserting the documented nextState/outcome shapes.
 */

const at = "2026-06-10T12:00:00.000Z";

describe("3.1 — pure transition", () => {
  test("Stage-1 confirm advances to Stage 2 discovery", () => {
    const state = buildDialogState({ current_stage: 1 });
    const { nextState, outcome } = transition(state, { kind: "confirm_framing", text: "yes that framing is correct", at });
    expect(nextState.current_stage).toBe(2);
    expect(outcome).toMatchObject({ kind: "ask", stage: 2, question: { type: "tension_resolution" } });
    expect(nextState.transcript.at(-1)).toMatchObject({ role: "user", stage: 1 });
  });

  test("Stage-1 rejection loops back without advancing (P4-T11)", () => {
    const state = buildDialogState({ current_stage: 1 });
    const { nextState, outcome } = transition(state, { kind: "reject_framing", text: "no — I meant encoding, not decoding", at });
    expect(nextState.current_stage).toBe(1);
    expect(outcome).toMatchObject({ kind: "ask", stage: 1, question: { type: "framing_regenerated" } });
  });

  test("Stage-2 tension pick encodes the resolution into the drafted set", () => {
    const state = buildDialogState({
      current_stage: 2,
      intents_drafted: [{ tensions_surfaced: [{ target: "api/pagination/cursor-only", classification: "overlap", resolution_options: ["extend", "supersede"] }] }],
    });
    const { nextState, outcome } = transition(state, {
      kind: "resolve_tensions",
      text: "extend the existing parent",
      payload: { resolutions: [{ target: "api/pagination/cursor-only", resolution: "extend the existing parent" }] },
      at,
    });
    expect(nextState.current_stage).toBe(3);
    expect(outcome).toMatchObject({ kind: "ask", stage: 3, question: { type: "practice_proposal" } });
    expect(nextState.intents_drafted[0].tension_resolutions).toEqual([
      { target: "api/pagination/cursor-only", classification: "overlap", resolution: "extend the existing parent" },
    ]);
  });

  test("Stage-4 confirm with a matrix-negated predicate bounces to Stage 4 (never Stage 5)", () => {
    const state = buildDialogState({
      current_stage: 4,
      intents_drafted: [
        {
          id: "api/no-offset",
          description: "List endpoints avoid offset pagination.",
          obligation: "must",
          triples: [{ id: "t1", subject: "list endpoints", predicate: "does not use", object: "offset pagination", polarity: "positive" }],
        },
      ],
    });
    const { nextState, outcome } = transition(state, { kind: "confirm_draft", text: "confirm", at });
    expect(nextState.current_stage).toBe(4);
    expect(outcome.kind).toBe("ask");
    if (outcome.kind !== "ask") return;
    expect(outcome.question).toMatchObject({ type: "stage45_bounce" });
    if (outcome.question.type !== "stage45_bounce") return;
    expect(outcome.question.violation.skill_hint).toBe("polarity-decision");
    // The offending triple is preserved for revision.
    expect(nextState.intents_drafted[0].triples?.[0].predicate).toBe("does not use");
  });

  test("classifyUserResponse: Stage-1 default is loopback unless affirmative", () => {
    const state = buildDialogState({ current_stage: 1 });
    expect(classifyUserResponse(state, "yes, exactly")).toBe("confirm_framing");
    expect(classifyUserResponse(state, "hmm, I actually meant the encode side")).toBe("reject_framing");
  });

  test("pyramidChild derives canonical covers-X triples from the impl clauses", () => {
    const child = pyramidChild(
      {
        id: "api/widget",
        obligation: "must",
        triples: [{ id: "shape", subject: "the widget endpoint", predicate: "return", object: "a typed widget", polarity: "positive" }],
      },
      "unit-tests",
    );
    expect(child.id).toBe("api/widget/unit-tests");
    expect(child.triples?.[0]).toMatchObject({ id: "covers-shape", predicate: "verifies" });
  });
});
