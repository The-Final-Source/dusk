import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { duskError, err, ok, type DialogState, type Intent, type RuntimeResult } from "@dusk/core-schema";
import { readIntentFile, serializeIntent } from "@dusk/core-parser";

import { destroyDialog } from "./dialogStore.js";
import { draftToIntent, validateDrafts } from "./validateDraft.js";

/**
 * Stage-5 atomic finalize (design D8). Every drafted intent is written via the
 * Phase-1 temp + rename semantics; if ANY single write fails, every pending
 * write is rolled back (temp files deleted, already-renamed targets restored)
 * and the dialog is PRESERVED so the user can fix and re-finalize. In-place
 * triple edits (`scoped_triple_edit`) replace the failing triple inside the
 * existing intent file — no new intent file is created.
 */

export type FinalizeFs = {
  writeFile: (path: string, content: string) => void;
  rename: (from: string, to: string) => void;
  mkdir: (dir: string) => void;
};

const realFs: FinalizeFs = {
  writeFile: (path, content) => writeFileSync(path, content, "utf8"),
  rename: (from, to) => renameSync(from, to),
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
};

export type FinalizeInput = {
  rootDir: string;
  intentsDir: string;
  state: DialogState;
  fs?: FinalizeFs;
};

type PlannedWrite = { intentPath: string; finalPath: string; tempPath: string; content: string; original: string | null };

export function finalizeDialog(input: FinalizeInput): RuntimeResult<{ intents_created: string[] }> {
  const fs = input.fs ?? realFs;
  const { state } = input;

  const partialFailure = (failedIntentPath: string, reason: string) =>
    duskError("author_finalize_partial_failure", `finalize failed writing ${failedIntentPath}; all writes rolled back`, {
      recoverable: true,
      details: { failed_intent_path: failedIntentPath, reason },
      recovery_hint: "the dialog is preserved — fix the cause and call dusk_author_finalize again",
    });

  // ---- Re-validate (Stage 5 never sees a non-validating intent; defense-in-depth). ----
  const violations = validateDrafts(state.intents_drafted);
  if (violations.length > 0) {
    const v = violations[0];
    return err(
      duskError("author_intent_schema_invalid", `drafted intent ${v.draft_id} failed validation at finalize: ${v.message}`, {
        recoverable: true,
        details: { failed_intent_path: v.draft_id, reason: v.message },
        recovery_hint: "revise the draft via dusk_author_continue until Stage 4.5 passes, then finalize",
      }),
    );
  }

  // ---- Assemble the write plan. ----
  const plan: PlannedWrite[] = [];
  for (const draft of state.intents_drafted) {
    // Pure Stage-2 scaffolds (no id, no triples) carry bookkeeping only — nothing to write.
    if (draft.in_place_edit) {
      const target = draft.in_place_edit.target_intent_path;
      const finalPath = join(input.rootDir, input.intentsDir, target, "intent.yaml");
      if (!existsSync(finalPath)) {
        return err(partialFailure(target, `in-place edit target ${finalPath} does not exist`));
      }
      const loaded = readIntentFile(finalPath, target);
      if (!loaded.success) {
        return err(partialFailure(target, `in-place edit target failed to parse: ${loaded.errors[0]?.message ?? "unknown"}`));
      }
      const edited = draft.triples?.find((t) => t.id === draft.in_place_edit!.triple_id);
      if (!edited) return err(partialFailure(target, `draft is missing the edited triple "${draft.in_place_edit.triple_id}"`));
      const merged: Intent = {
        ...loaded.intent,
        triples: (loaded.intent.triples ?? []).map((t) => (t.id === edited.id ? edited : t)),
      };
      plan.push({
        intentPath: target,
        finalPath,
        tempPath: `${finalPath}.tmp-author-${process.pid}`,
        content: serializeIntent(merged),
        original: readFileSync(finalPath, "utf8"),
      });
      continue;
    }

    if (draft.id === undefined && draft.triples === undefined && draft.antecedent === undefined) continue; // scaffold

    const intent = draftToIntent(draft);
    if (!intent) {
      return err(
        duskError("author_intent_schema_invalid", `drafted intent ${draft.id ?? "(draft)"} failed v2 schema validation at finalize`, {
          recoverable: true,
          details: { failed_intent_path: draft.id ?? null },
        }),
      );
    }
    const finalPath = join(input.rootDir, input.intentsDir, intent.id, "intent.yaml");
    const original = existsSync(finalPath) ? readFileSync(finalPath, "utf8") : null;
    plan.push({ intentPath: intent.id, finalPath, tempPath: `${finalPath}.tmp-author-${process.pid}`, content: serializeIntent(intent), original });
  }

  if (plan.length === 0) {
    return err(
      duskError("author_stage_invalid_response", "the dialog has no drafted intents to finalize", {
        recoverable: true,
        recovery_hint: "drive Stage 4 drafting via dusk_author_continue before finalizing",
      }),
    );
  }

  // ---- Phase A: write every temp sibling (no target touched on failure). ----
  const written: PlannedWrite[] = [];
  const cleanupTemps = (): void => {
    for (const w of written) rmSync(w.tempPath, { force: true });
  };
  for (const w of plan) {
    try {
      fs.mkdir(dirname(w.finalPath));
      fs.writeFile(w.tempPath, w.content);
      written.push(w);
    } catch (error) {
      cleanupTemps();
      return err(partialFailure(w.intentPath, (error as Error).message));
    }
  }

  // ---- Phase B: rename all (restore any already-renamed target on failure). ----
  const renamed: PlannedWrite[] = [];
  for (const w of plan) {
    try {
      fs.rename(w.tempPath, w.finalPath);
      renamed.push(w);
    } catch (error) {
      for (const r of renamed) {
        if (r.original !== null) writeFileSync(r.finalPath, r.original, "utf8");
        else rmSync(r.finalPath, { force: true });
      }
      cleanupTemps();
      return err(partialFailure(w.intentPath, (error as Error).message));
    }
  }

  // ---- Success: destroy the dialog (single atomic transaction completed). ----
  destroyDialog(input.rootDir, state.dialog_id);
  return ok({ intents_created: plan.map((w) => w.intentPath) });
}
