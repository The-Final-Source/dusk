import { describe, expect, test } from "vitest";

import {
  AuthorEntryModeSchema,
  DialogInitSchema,
  DialogStateSchema,
  DraftIntentSchema,
  ResolveLivelockRequestSchema,
  isDialogId,
} from "./index.js";

/**
 * 1.2 — the Phase-4 frozen seam types (unit-only; pure schema transforms).
 * Behavior under test: canonical DialogState fixtures parse; drafts can carry
 * the violations Stage 4.5 exists to bounce; the rewired resolve-livelock
 * signature has NO payload parameter.
 */

const canonicalState = {
  schema_version: 1,
  dialog_id: "dlg_20260610120000001",
  request: "add cursor encoding for paginated lists",
  current_stage: "4.5",
  transcript: [
    { role: "author", content: "Here is my framing…", stage: 1, at: "2026-06-10T12:00:00.000Z" },
    { role: "user", content: "yes that framing is correct", stage: 1, at: "2026-06-10T12:00:05.000Z" },
  ],
  intents_drafted: [
    {
      id: "api/pagination/cursor-only/cursor-encode",
      description: "Cursor encoding produces an opaque token.",
      obligation: "must",
      compose: "all",
      triples: [{ id: "opaque-token", subject: "the cursor encode function", predicate: "produce", object: "an opaque token", polarity: "positive" }],
    },
  ],
  created_at: "2026-06-10T12:00:00.000Z",
  last_touched_at: "2026-06-10T12:00:05.000Z",
};

describe("1.2 — DialogState is the frozen Phase-4 seam", () => {
  test("a canonical populated DialogState parses with every field intact", () => {
    const parsed = DialogStateSchema.parse(canonicalState);
    expect(parsed.dialog_id).toBe("dlg_20260610120000001");
    expect(parsed.current_stage).toBe("4.5");
    expect(parsed.transcript).toHaveLength(2);
    expect(parsed.intents_drafted[0].id).toBe("api/pagination/cursor-only/cursor-encode");
  });

  test("a malformed dialog_id is rejected", () => {
    expect(() => DialogStateSchema.parse({ ...canonicalState, dialog_id: "dlg_nope" })).toThrow();
  });

  test("dialog ids follow the App. D.8 dlg_ format", () => {
    expect(isDialogId("dlg_20260610120000001")).toBe(true);
    expect(isDialogId("rt_20260610120000001")).toBe(false);
  });

  test("drafts can carry the exact violations Stage 4.5 bounces (negated predicate, behavioral antecedent, refines kind)", () => {
    const violating = DraftIntentSchema.parse({
      id: "api/widget",
      compose: "implies",
      antecedent: [{ id: "a1", subject: "the endpoint", predicate: "performs a write", object: "api/write-endpoint" }],
      consequent: [{ id: "t1", subject: "list endpoints", predicate: "does not use", object: "offset pagination" }],
      relates_to: [{ kind: "refines", target: "api/other" }],
    });
    expect(violating.antecedent?.[0].predicate).toBe("performs a write");
    expect(violating.relates_to?.[0].kind).toBe("refines");
  });

  test("entry modes are the three pinned values", () => {
    expect(AuthorEntryModeSchema.options).toEqual(["full", "scoped_triple_edit", "l2_recovery"]);
  });

  test("the rewired dusk_resolve_livelock signature carries dialog_init and rejects payload", () => {
    const parsed = ResolveLivelockRequestSchema.parse({
      bead_id: "bd_20260610120000001",
      verb: "modify_triple",
      dialog_init: { failing_triple: { subject: "s", predicate: "p", object: "o", polarity: "positive" }, target_intent_path: "api/widget/unit-tests", failing_triple_id: "covers-shape" },
    });
    expect(parsed.dialog_init?.failing_triple_id).toBe("covers-shape");
    expect(() => ResolveLivelockRequestSchema.parse({ bead_id: "bd_x", verb: "modify_triple", payload: { edited_triple: {} } })).toThrow();
    expect(() => DialogInitSchema.parse({ edited_triple: {} })).toThrow();
  });
});
