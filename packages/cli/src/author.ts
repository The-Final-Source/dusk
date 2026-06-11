import { createAuthorRuntime, makeModelAuthorGenerator, type AuthorRuntime } from "@dusk/runtime-author";
import { readRuntimeEnv, spawnSubAgent, type TaskRunner } from "@dusk/runtime-orchestrator";
import { claudeCodeAvailable, claudeCodeModelClient } from "@dusk/runtime-verifier";

/**
 * `dusk author` (Phase-4 CLI surface) — the direct-invocation mirror of the
 * `dusk_author_*` MCP tools, for debugging:
 *   dusk author <request>                          → dusk_author_start
 *   dusk author --continue <dialog_id> <response>  → dusk_author_continue
 *   dusk author --finalize <dialog_id>             → dusk_author_finalize
 * Runs the Author on the ambient Claude Code model (no API key); a test can
 * inject a scripted runtime via `opts.runtime`.
 */

export const AUTHOR_HELP = `dusk author <request>
  Open an intent-authoring dialog (the 5-stage flow: framing → discovery →
  practice → drafting → commit) and print the dialog id + first question.
  dusk author --continue <dialog_id> <response>   advance the dialog one turn
  dusk author --finalize <dialog_id>              atomically commit the drafted intents
  Example: dusk author "add cursor encoding for paginated lists"
  Example: dusk author --continue dlg_20260610120000001 "yes that framing is correct"
  Example: dusk author --finalize dlg_20260610120000001
`;

export type AuthorCliResult = { ok: boolean; text: string };

export type AuthorCliOptions = {
  runtime?: AuthorRuntime;
  clock?: { now: () => number };
};

function buildAmbientRuntime(root: string, clock: { now: () => number }): AuthorRuntime {
  const modelClient = claudeCodeModelClient({ model: "claude-sonnet-4-6" });
  const taskRunner: TaskRunner = async (call) => {
    const completion = await modelClient.complete({ system: call.prompt, user: "Proceed.", temperature: 0 });
    return { output: completion.text, model: "claude-sonnet-4-6", promptTokens: completion.usage.promptTokens, completionTokens: completion.usage.completionTokens, costUsd: completion.usage.costUsd ?? 0, latencyMs: 0 };
  };
  const sessionId = `cli_author_${clock.now()}`;
  return createAuthorRuntime({
    rootDir: root,
    clock,
    generator: makeModelAuthorGenerator({
      rootDir: root,
      sessionId,
      spawn: (params) => spawnSubAgent(params, { rootDir: root, env: readRuntimeEnv(), clock, taskRunner }),
    }),
  });
}

export async function runAuthorCli(root: string, rest: string[], opts: AuthorCliOptions = {}): Promise<AuthorCliResult> {
  if (rest.length === 0) return { ok: false, text: AUTHOR_HELP };

  const clock = opts.clock ?? { now: () => Date.now() };
  if (!opts.runtime && !claudeCodeAvailable()) {
    return { ok: false, text: "dusk author needs the Claude Code CLI (`claude`) on PATH (the Author runs on the ambient model — no API key required).\n" };
  }
  const runtime = opts.runtime ?? buildAmbientRuntime(root, clock);

  if (rest[0] === "--continue") {
    const [, dialogId, ...responseParts] = rest;
    if (!dialogId || responseParts.length === 0) return { ok: false, text: `usage: dusk author --continue <dialog_id> <response>\n${AUTHOR_HELP}` };
    const result = await runtime.continue({ dialog_id: dialogId, response: responseParts.join(" ") });
    if (!result.success) return { ok: false, text: `author: ${result.error.kind} — ${result.error.message}\n` };
    if ("finalize_ready" in result.value) {
      return { ok: true, text: `dialog ${dialogId} is finalize-ready — run: dusk author --finalize ${dialogId}\n` };
    }
    return { ok: true, text: `[stage ${result.value.stage}] ${result.value.next_question}\n` };
  }

  if (rest[0] === "--finalize") {
    const dialogId = rest[1];
    if (!dialogId) return { ok: false, text: `usage: dusk author --finalize <dialog_id>\n${AUTHOR_HELP}` };
    const result = await runtime.finalize({ dialog_id: dialogId });
    if (!result.success) return { ok: false, text: `author: ${result.error.kind} — ${result.error.message}\n` };
    return { ok: true, text: `created intents:\n${result.value.intents_created.map((p) => `  ${p}\n`).join("")}` };
  }

  const request = rest.filter((a) => !a.startsWith("--")).join(" ");
  if (!request) return { ok: false, text: AUTHOR_HELP };
  const result = await runtime.start({ request });
  if (!result.success) return { ok: false, text: `author: ${result.error.kind} — ${result.error.message}\n` };
  return { ok: true, text: `dialog ${result.value.dialog_id} opened at stage ${result.value.stage}\n[stage ${result.value.stage}] ${result.value.next_question}\n` };
}
