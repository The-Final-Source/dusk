import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { DialogStateSchema, type DialogState } from "@dusk/core-schema";

/**
 * Phase-4 dialog test fixtures: a `DialogState` builder for synthesizing
 * arbitrary states, and a lightweight tail-reader over
 * `.ia/runtime/dialogs/<dialog-id>/state.md` for in-test assertions (the
 * production parser lives in `@dusk/runtime-author`; this reader is
 * intentionally independent so harness assertions don't depend on it).
 */

export function buildDialogState(overrides: Partial<DialogState> = {}): DialogState {
  return DialogStateSchema.parse({
    schema_version: 1,
    dialog_id: "dlg_20260610120000001",
    request: "add cursor encoding for paginated lists",
    current_stage: 1,
    transcript: [],
    intents_drafted: [],
    created_at: "2026-06-10T12:00:00.000Z",
    last_touched_at: "2026-06-10T12:00:00.000Z",
    ...overrides,
  });
}

export type DialogTail = {
  raw: string;
  frontmatter: Record<string, unknown>;
  /** Raw `## Turn N` section bodies, in order. */
  turns: string[];
};

/** Load a dialog's state.md for byte-level + frontmatter assertions. */
export function readDialogTail(rootDir: string, dialogId: string): DialogTail | null {
  const path = join(rootDir, ".ia/runtime/dialogs", dialogId, "state.md");
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const frontmatter = fm ? ((parseYaml(fm[1]) as Record<string, unknown>) ?? {}) : {};
  const transcriptIdx = raw.indexOf("\n## Transcript\n");
  const turns =
    transcriptIdx === -1
      ? []
      : raw
          .slice(transcriptIdx + "\n## Transcript\n".length)
          .split(/\n## Turn \d+\n\n/)
          .filter((part) => part.trim().length > 0);
  return { raw, frontmatter, turns };
}
