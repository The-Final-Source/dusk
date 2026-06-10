import { existsSync } from "node:fs";

import { ImplementCheckpointSchema, type ImplementCheckpoint } from "@dusk/core-schema";
import { DAY_MS, HOUR_MS, createTempRepo, mockClock, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  checkpointPath,
  deleteCheckpoint,
  gcCheckpoints,
  loadForResume,
  newResumeToken,
  suggestedDialogSeed,
  writeCheckpoint,
} from "./checkpoint.js";

const makeCheckpoint = (overrides: Partial<ImplementCheckpoint> = {}): ImplementCheckpoint => ({
  schema_version: 1,
  original_request: "add cursor decoding for paginated lists",
  scope_hint: ["api/pagination"],
  decomposer_partial_state: { active_intents: ["api/pagination"], edges: [] },
  intents_resolved_so_far: ["api/pagination"],
  intents_still_unresolved: ["api/pagination/cursor-window"],
  suggested_dialog_seed: suggestedDialogSeed(["api/pagination/cursor-window"]),
  unresolved_refs: ["api/pagination/cursor-window"],
  created_at: "2026-06-10T00:00:00.000Z",
  last_touched_at: "2026-06-10T00:00:00.000Z",
  ...overrides,
});

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
});
afterEach(() => repo.cleanup());

describe("3.1 — write/read round-trip at the documented path with rt_ token", () => {
  test("token matches the App. D.8 format and the JSON parses against the schema", () => {
    const clock = mockClock(Date.parse("2026-06-10T12:30:45.000Z"));
    const token = newResumeToken(clock, 1);
    expect(token).toMatch(/^rt_[0-9]{14}[0-9]{3}$/);
    expect(token).toBe("rt_20260610123045001");

    const path = writeCheckpoint(repo.dir, token, makeCheckpoint());
    expect(path).toBe(checkpointPath(repo.dir, token));
    expect(existsSync(path)).toBe(true);

    const read = loadForResume(repo.dir, token, clock);
    expect(read.success).toBe(true);
    if (!read.success) return;
    expect(ImplementCheckpointSchema.safeParse(read.value).success).toBe(true);
    expect(read.value.suggested_dialog_seed).toBe("api/pagination/cursor-window");
  });
});

describe("3.2 — single-use: deletion makes a second resume expired (P3-T6)", () => {
  test("after deleteCheckpoint, loadForResume returns implement_resume_token_expired", () => {
    const clock = mockClock(Date.parse("2026-06-10T00:00:00.000Z"));
    const token = newResumeToken(clock, 2);
    writeCheckpoint(repo.dir, token, makeCheckpoint());

    const first = loadForResume(repo.dir, token, clock);
    expect(first.success).toBe(true);

    deleteCheckpoint(repo.dir, token); // Step-1 transition consumes it
    expect(existsSync(checkpointPath(repo.dir, token))).toBe(false);

    const second = loadForResume(repo.dir, token, clock);
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error.kind).toBe("implement_resume_token_expired");
  });
});

describe("3.3 — 24h TTL expiry preserves the original request (P3-T7)", () => {
  test("a checkpoint aged past 24h returns expired with original_request in recovery_hint", () => {
    const clock = mockClock(Date.parse("2026-06-10T00:00:00.000Z"));
    const token = newResumeToken(clock, 3);
    writeCheckpoint(repo.dir, token, makeCheckpoint({ last_touched_at: "2026-06-10T00:00:00.000Z" }));

    clock.advance(DAY_MS + HOUR_MS); // 25h later
    const result = loadForResume(repo.dir, token, clock);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.kind).toBe("implement_resume_token_expired");
    expect(result.error.recoverable).toBe(false);
    expect(result.error.recovery_hint).toContain("add cursor decoding for paginated lists");
  });

  test("a checkpoint within 24h is still resumable", () => {
    const clock = mockClock(Date.parse("2026-06-10T00:00:00.000Z"));
    const token = newResumeToken(clock, 4);
    writeCheckpoint(repo.dir, token, makeCheckpoint({ last_touched_at: "2026-06-10T00:00:00.000Z" }));
    clock.advance(HOUR_MS); // 1h later
    expect(loadForResume(repo.dir, token, clock).success).toBe(true);
  });
});

describe("3.4 — gc reaps stale checkpoints, preserves fresh, idempotent", () => {
  test("only the 30h-old checkpoint is reaped; second run is a no-op", () => {
    const now = Date.parse("2026-06-11T00:00:00.000Z");
    const clock = mockClock(now);
    const staleToken = newResumeToken(mockClock(now - 30 * HOUR_MS), 1);
    const freshToken = newResumeToken(mockClock(now - HOUR_MS), 2);
    writeCheckpoint(repo.dir, staleToken, makeCheckpoint({ last_touched_at: new Date(now - 30 * HOUR_MS).toISOString() }));
    writeCheckpoint(repo.dir, freshToken, makeCheckpoint({ last_touched_at: new Date(now - HOUR_MS).toISOString() }));

    const reaped = gcCheckpoints(repo.dir, clock);
    expect(reaped).toEqual([staleToken]);
    expect(existsSync(checkpointPath(repo.dir, staleToken))).toBe(false);
    expect(existsSync(checkpointPath(repo.dir, freshToken))).toBe(true);

    expect(gcCheckpoints(repo.dir, clock)).toEqual([]); // idempotent
  });
});
