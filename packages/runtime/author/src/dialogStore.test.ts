import { describe, expect, test } from "vitest";
import { DIALOG_ID_RE } from "@dusk/core-schema";
import { buildDialogState, createTempRepo, manualClock } from "@dusk/test-harness";

import {
  DIALOG_TTL_MS,
  dialogStatePath,
  gcDialogs,
  listDialogs,
  newDialogId,
  parseDialogState,
  readDialogState,
  serializeDialogState,
  withDialogLock,
  writeDialogState,
} from "./dialogStore.js";

/**
 * §2 dialog-state (zero-model + real fs). Round-trip byte identity, App. D.8
 * id format, advisory-lock serialization, and the 24h GC window.
 */

const populated = () =>
  buildDialogState({
    current_stage: 3,
    transcript: [
      { role: "author", content: "Here is my framing of the request.", stage: 1, at: "2026-06-10T12:00:00.000Z" },
      { role: "user", content: "yes that framing is correct", stage: 1, at: "2026-06-10T12:00:05.000Z" },
      { role: "author", content: "I found one overlap:\n- api/pagination/cursor-only (overlap)", stage: 2, at: "2026-06-10T12:00:10.000Z" },
    ],
    intents_drafted: [
      {
        id: "api/pagination/cursor-only/cursor-encode",
        description: "Cursor encoding produces an opaque token.",
        obligation: "must",
        triples: [{ id: "opaque-token", subject: "the encode function", predicate: "produce", object: "an opaque token", polarity: "positive" }],
        tension_resolutions: [{ target: "api/pagination/cursor-only", classification: "overlap", resolution: "extend the existing parent" }],
      },
    ],
  });

describe("2.1 — disk format round-trips byte-identically", () => {
  test("a populated dialog round-trips byte-identically", () => {
    const raw = serializeDialogState(populated());
    const parsed = parseDialogState(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(serializeDialogState(parsed.value)).toBe(raw);
  });

  test("a new turn appends without rewriting prior Turn sections", () => {
    const state = populated();
    const before = serializeDialogState(state);
    const turnSections = before.split(/\n## Turn \d+\n\n/).slice(1);

    const appended = {
      ...state,
      transcript: [...state.transcript, { role: "user" as const, content: "extend the existing parent", stage: 2 as const, at: "2026-06-10T12:00:20.000Z" }],
    };
    const after = serializeDialogState(appended);
    for (const section of turnSections) {
      expect(after).toContain(section);
    }
    expect(after.match(/## Turn \d+/g)).toHaveLength(4);
  });
});

describe("2.2 — dialog_id generation (Clock-injected App. D.8)", () => {
  test("generated id matches dlg_<14-digit-ts><3-digit-seq> and increments within a tick", () => {
    const repo = createTempRepo({ git: false });
    const clock = manualClock(Date.UTC(2026, 5, 10, 12, 0, 0));
    const first = newDialogId(repo.dir, clock);
    expect(first).toMatch(DIALOG_ID_RE);

    writeDialogState(repo.dir, buildDialogState({ dialog_id: first }));
    const second = newDialogId(repo.dir, clock);
    expect(second).toMatch(DIALOG_ID_RE);
    expect(second.slice(0, -3)).toBe(first.slice(0, -3));
    expect(Number(second.slice(-3))).toBe(Number(first.slice(-3)) + 1);
    repo.cleanup();
  });

  test("state file is written at the documented path with documented frontmatter", () => {
    const repo = createTempRepo({ git: false });
    const state = buildDialogState({});
    writeDialogState(repo.dir, state);
    expect(repo.exists(`.ia/runtime/dialogs/${state.dialog_id}/state.md`)).toBe(true);
    const raw = repo.read(`.ia/runtime/dialogs/${state.dialog_id}/state.md`);
    for (const field of ["dialog_id:", "request:", "current_stage:", "created_at:", "last_touched_at:"]) {
      expect(raw).toContain(field);
    }
    repo.cleanup();
  });
});

describe("2.4 — concurrent writes serialize via the per-dialog advisory lock", () => {
  test("two concurrent continues serialize; both turns land in order", async () => {
    const repo = createTempRepo({ git: false });
    const state = buildDialogState({});
    writeDialogState(repo.dir, state);

    const appendTurn = (label: string, delayMs: number) =>
      withDialogLock(repo.dir, state.dialog_id, async () => {
        const read = readDialogState(repo.dir, state.dialog_id);
        if (!read.success) throw new Error("dialog missing");
        await new Promise((r) => setTimeout(r, delayMs)); // hold the lock across an await point
        writeDialogState(repo.dir, {
          ...read.value,
          transcript: [...read.value.transcript, { role: "user" as const, content: label, stage: 1 as const, at: "2026-06-10T12:00:00.000Z" }],
        });
      });

    await Promise.all([appendTurn("first", 30), appendTurn("second", 0)]);
    const final = readDialogState(repo.dir, state.dialog_id);
    expect(final.success).toBe(true);
    if (!final.success) return;
    expect(final.value.transcript.map((t) => t.content)).toEqual(["first", "second"]);
    repo.cleanup();
  });

  test("a continue racing a finalize loses with author_dialog_id_unknown", async () => {
    const repo = createTempRepo({ git: false });
    const state = buildDialogState({});
    writeDialogState(repo.dir, state);

    const finalize = withDialogLock(repo.dir, state.dialog_id, async () => {
      const { destroyDialog } = await import("./dialogStore.js");
      destroyDialog(repo.dir, state.dialog_id);
    });
    const loser = withDialogLock(repo.dir, state.dialog_id, async () => readDialogState(repo.dir, state.dialog_id));

    await finalize;
    const result = await loser;
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.kind).toBe("author_dialog_id_unknown");
    repo.cleanup();
  });
});

describe("2.6 — 24h GC reaps stale dialogs, preserves fresh ones (P4-T10)", () => {
  test("a 30h-old dialog is reaped; a 1h-old one survives", () => {
    const repo = createTempRepo({ git: false });
    const now = Date.UTC(2026, 5, 10, 12, 0, 0);
    const clock = manualClock(now);

    const stale = buildDialogState({ dialog_id: "dlg_20260609060000001", last_touched_at: new Date(now - 30 * 3_600_000).toISOString() });
    const fresh = buildDialogState({ dialog_id: "dlg_20260610110000001", last_touched_at: new Date(now - 1 * 3_600_000).toISOString() });
    writeDialogState(repo.dir, stale);
    writeDialogState(repo.dir, fresh);

    const reaped = gcDialogs(repo.dir, clock);
    expect(reaped).toEqual([stale.dialog_id]);
    expect(repo.exists(`.ia/runtime/dialogs/${stale.dialog_id}/state.md`)).toBe(false);
    expect(repo.exists(`.ia/runtime/dialogs/${fresh.dialog_id}/state.md`)).toBe(true);
    expect(DIALOG_TTL_MS).toBe(24 * 3_600_000);

    expect(listDialogs(repo.dir).map((d) => d.dialog_id)).toEqual([fresh.dialog_id]);
    expect(dialogStatePath(repo.dir, fresh.dialog_id)).toContain(".ia/runtime/dialogs");
    repo.cleanup();
  });
});
