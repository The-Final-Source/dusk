import {
  AuthorEntryModeSchema,
  DialogInitSchema,
  duskError,
  err,
  ok,
  type RuntimeResult,
} from "@dusk/core-schema";
import {
  listDialogs,
  type AuthorRuntime,
  type ContinueResult,
  type DialogSummary,
  type FinalizeResult,
  type StartResult,
} from "@dusk/runtime-author";

/**
 * The Phase-4 MCP author surface: `dusk_author_start` / `dusk_author_continue`
 * / `dusk_author_finalize` thin-wrap the injected Author runtime (which owns
 * persistence, locking, and the 5-stage flow), plus the shared
 * `dusk_list_dialogs` ↔ `dusk://dialogs/active` query (Phase-2 design D10
 * paired-tool/resource pattern). Every failure is a typed `DuskError`; no
 * exception escapes the MCP boundary (App. A.11).
 */

export type AuthorSurfaceDeps = {
  runtime: AuthorRuntime;
};

export type StartArgsRaw = {
  request: string;
  entry_mode?: string;
  dialog_init?: Record<string, unknown>;
};

export async function duskAuthorStart(deps: AuthorSurfaceDeps, args: StartArgsRaw): Promise<RuntimeResult<StartResult>> {
  const mode = AuthorEntryModeSchema.safeParse(args.entry_mode ?? "full");
  if (!mode.success) {
    return err(
      duskError("config_invalid", `unknown entry_mode "${args.entry_mode}"`, {
        recoverable: true,
        recovery_hint: 'entry_mode is one of "full" | "scoped_triple_edit" | "l2_recovery"',
      }),
    );
  }
  const init = DialogInitSchema.safeParse(args.dialog_init ?? {});
  if (!init.success) {
    return err(
      duskError("config_invalid", `dialog_init failed validation: ${init.error.issues[0]?.message ?? "invalid"}`, {
        recoverable: true,
        recovery_hint: "dialog_init carries { failing_triple, target_intent_path, failing_triple_id } (scoped) or { proposal_path } (l2)",
      }),
    );
  }
  return deps.runtime.start({ request: args.request, entry_mode: mode.data, dialog_init: init.data });
}

export async function duskAuthorContinue(
  deps: AuthorSurfaceDeps,
  args: { dialog_id: string; response: string; payload?: Record<string, unknown> },
): Promise<RuntimeResult<ContinueResult>> {
  return deps.runtime.continue(args);
}

export async function duskAuthorFinalize(deps: AuthorSurfaceDeps, args: { dialog_id: string }): Promise<RuntimeResult<FinalizeResult>> {
  return deps.runtime.finalize(args);
}

/** The single shared query behind `dusk_list_dialogs` AND `dusk://dialogs/active`. */
export function listDialogsQuery(rootDir: string): RuntimeResult<{ dialogs: DialogSummary[] }> {
  return ok({ dialogs: listDialogs(rootDir) });
}
