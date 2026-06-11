import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DraftIntent, ScriptedAuthorResponse } from "@dusk/core-schema";
import { createAuthorRuntime, writeDialogState, gcDialogs, type AuthorRuntime } from "@dusk/runtime-author";
import { buildDialogState, createTempRepo, HOUR_MS, makeScriptedAuthorGenerator, manualClock, type TempRepo } from "@dusk/test-harness";
import { describe, expect, test } from "vitest";

import { newResumeToken, writeCheckpoint } from "@dusk/runtime-implement-checkpoint";

import { AUTHOR_HELP, runAuthorCli } from "./author.js";
import { gcCheckpointsCommand, gcDialogsCommand } from "./doctorP3.js";
import { scaffoldProject } from "./scaffold.js";

/**
 * §8 — `dusk author` CLI mirror (zero-model via the scripted Author driver) +
 * the /dusk-author slash-command asset + the real-state dialog GC
 * (smoke Variant D's dialog half).
 */

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);

const runBin = (args: string[], cwd: string): { code: number; out: string } => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: err.stdout ?? "" };
  }
};

const DRAFT: DraftIntent = {
  id: "api/widget",
  description: "Widget endpoint returns typed widgets.",
  obligation: "must",
  triples: [{ id: "shape", subject: "the widget endpoint", predicate: "return", object: "a typed widget", polarity: "positive" }],
};

const scriptedRuntime = (repo: TempRepo, script: ScriptedAuthorResponse[]): AuthorRuntime =>
  createAuthorRuntime({ rootDir: repo.dir, clock: manualClock(NOW), generator: makeScriptedAuthorGenerator(script) });

describe("8.1 — dusk author <request> opens a dialog and prints the first question", () => {
  test("prints the dialog id + framing and succeeds", async () => {
    const repo = createTempRepo({ git: false });
    const runtime = scriptedRuntime(repo, [{ expectStage: 1, question: "Confirm the framing?" }]);
    const result = await runAuthorCli(repo.dir, ["add cursor encoding for paginated lists"], { runtime });
    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/dialog dlg_[0-9]{17} opened at stage 1/);
    expect(result.text).toContain("Confirm the framing?");
    repo.cleanup();
  });
});

describe("8.2 / 8.3 — --continue and --finalize mirror the MCP tools", () => {
  test("a pre-existing dialog advances, reaches finalize-ready, and finalize prints the created paths", async () => {
    const repo = createTempRepo({ git: false });
    const runtime = scriptedRuntime(repo, [
      { expectStage: 1, question: "Framing?" },
      { expectStage: 2, question: "Tensions?", tensions: [] },
      { expectStage: 3, question: "Practice?", practiceProposal: "p" },
      { expectStage: 4, question: "Drafted. Layers?", draftPatch: DRAFT },
    ]);
    const started = await runAuthorCli(repo.dir, ["widget endpoint"], { runtime });
    const dialogId = started.text.match(/dlg_[0-9]{17}/)![0];

    const advanced = await runAuthorCli(repo.dir, ["--continue", dialogId, "yes", "that", "framing", "is", "correct"], { runtime });
    expect(advanced.ok).toBe(true);
    expect(advanced.text).toContain("[stage 3]"); // zero tensions auto-advance

    await runAuthorCli(repo.dir, ["--continue", dialogId, "accept"], { runtime });
    // Structured picks travel via the MCP payload; the CLI's free-text "confirm"
    // path covers the no-children default.
    const picked = await runAuthorCli(repo.dir, ["--continue", dialogId, "no", "test", "children"], { runtime });
    expect(picked.ok).toBe(true);

    const ready = await runAuthorCli(repo.dir, ["--continue", dialogId, "confirm"], { runtime });
    expect(ready.ok).toBe(true);
    expect(ready.text).toContain("finalize-ready");

    const finalized = await runAuthorCli(repo.dir, ["--finalize", dialogId], { runtime });
    expect(finalized.ok).toBe(true);
    expect(finalized.text).toContain("api/widget");
    expect(repo.exists(".ia/intents/api/widget/intent.yaml")).toBe(true);
    repo.cleanup();
  });
});

describe("8.4 — typed error path: unknown dialog → readable error + non-zero exit", () => {
  test("author_dialog_id_unknown surfaces in the output", async () => {
    const repo = createTempRepo({ git: false });
    const runtime = scriptedRuntime(repo, []);
    const result = await runAuthorCli(repo.dir, ["--continue", "dlg_nonexistent", "hello"], { runtime });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("author_dialog_id_unknown");
    repo.cleanup();
  });
});

describe("8.5 — --help on the author command", () => {
  test("dusk author --help exits 0 with usage + an example", () => {
    const repo = createTempRepo({ git: false });
    const r = runBin(["author", "--help"], repo.dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain("dusk author <request>");
    expect(r.out).toContain("Example:");
    expect(AUTHOR_HELP).toContain("--continue");
    expect(AUTHOR_HELP).toContain("--finalize");
    repo.cleanup();
  });

  test("dusk author with no args prints usage and exits 1", () => {
    const repo = createTempRepo({ git: false });
    const r = runBin(["author"], repo.dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("dusk author <request>");
    repo.cleanup();
  });
});

describe("4.5 — /dusk-author slash command ships and wraps the three MCP tools", () => {
  test("dusk init scaffolds .claude/commands/dusk-author.md naming all three tools", () => {
    const repo = createTempRepo({ git: false });
    scaffoldProject(repo.dir);
    const path = join(repo.dir, ".claude/commands/dusk-author.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    for (const tool of ["dusk_author_start", "dusk_author_continue", "dusk_author_finalize"]) {
      expect(content).toContain(tool);
    }
    expect(content).toContain("--continue");
    expect(content).toContain("--finalize");
    repo.cleanup();
  });
});

describe("10.3 Variant D — 24h GC reaps an aged dialog AND an aged checkpoint; fresh ones survive (P4-T10)", () => {
  test("dusk doctor --gc-dialogs + --gc-implement-checkpoints against one MockClock-aged repo", () => {
    const repo = createTempRepo({ git: false });
    const clock = manualClock(NOW);

    // Dialog pair — REAL dialog state, aged by last_touched_at.
    const staleDialog = buildDialogState({ dialog_id: "dlg_20260609060000001", last_touched_at: new Date(NOW - 30 * HOUR_MS).toISOString() });
    const freshDialog = buildDialogState({ dialog_id: "dlg_20260610110000001", last_touched_at: new Date(NOW - HOUR_MS).toISOString() });
    writeDialogState(repo.dir, staleDialog);
    writeDialogState(repo.dir, freshDialog);

    // Checkpoint pair — aged by last_touched_at.
    const checkpoint = (touchedMs: number) => ({
      schema_version: 1 as const,
      original_request: "add cursor encoding",
      decomposer_partial_state: { active_intents: [], edges: [] },
      intents_resolved_so_far: [],
      intents_still_unresolved: ["api/x"],
      suggested_dialog_seed: "enriched seed for api/x",
      unresolved_refs: ["api/x"],
      created_at: new Date(touchedMs).toISOString(),
      last_touched_at: new Date(touchedMs).toISOString(),
    });
    const staleToken = newResumeToken(manualClock(NOW - 30 * HOUR_MS), 1);
    const freshToken = newResumeToken(manualClock(NOW - HOUR_MS), 2);
    writeCheckpoint(repo.dir, staleToken, checkpoint(NOW - 30 * HOUR_MS));
    writeCheckpoint(repo.dir, freshToken, checkpoint(NOW - HOUR_MS));

    const dialogResult = gcDialogsCommand(repo.dir, clock);
    expect(dialogResult.exitCode).toBe(0);
    expect(dialogResult.text).toContain(staleDialog.dialog_id);
    expect(dialogResult.text).not.toContain(freshDialog.dialog_id);
    expect(existsSync(join(repo.dir, ".ia/runtime/dialogs", staleDialog.dialog_id))).toBe(false);
    expect(existsSync(join(repo.dir, ".ia/runtime/dialogs", freshDialog.dialog_id))).toBe(true);

    const checkpointResult = gcCheckpointsCommand(repo.dir, clock);
    expect(checkpointResult.exitCode).toBe(0);
    expect(checkpointResult.text).toContain(staleToken);
    expect(checkpointResult.text).not.toContain(freshToken);
    expect(existsSync(join(repo.dir, ".ia/runtime/implement", `${staleToken}.json`))).toBe(false);
    expect(existsSync(join(repo.dir, ".ia/runtime/implement", `${freshToken}.json`))).toBe(true);

    // Idempotent re-runs.
    expect(gcDialogs(repo.dir, clock)).toEqual([]);
    expect(gcCheckpointsCommand(repo.dir, clock).text).toBe("");
    repo.cleanup();
  });
});
