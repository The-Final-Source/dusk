import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { duskError, type RuntimeResult } from "@dusk/core-schema";
import { z } from "zod";

import type { DuskContext } from "./context.js";
import {
  getBeadQuery,
  getIntentQuery,
  inspectQuery,
  listBeadsQuery,
  listCheckpointsQuery,
  listIntentsQuery,
  listTracesQuery,
  statusQuery,
  verifyQuery,
} from "./queries.js";
import { duskCancel, duskImplement, duskResolveLivelock, duskTest, type WriteSurfaceDeps } from "./writeSurface.js";
import { duskAuthorContinue, duskAuthorFinalize, duskAuthorStart, listDialogsQuery, type AuthorSurfaceDeps } from "./authorSurface.js";

export const PHASE2_TOOL_NAMES = [
  "dusk_status",
  "dusk_inspect",
  "dusk_verify",
  "dusk_list_intents",
  "dusk_get_intent",
  "dusk_list_traces",
  "dusk_list_beads",
  "dusk_get_bead",
  "dusk_list_implement_checkpoints",
] as const;

export const PHASE2_RESOURCE_URIS = [
  "dusk://intents",
  "dusk://traces/recent",
  "dusk://beads/active",
  "dusk://implement-checkpoints",
] as const;

/** Translate an internal Result into a CallToolResult — never throws across the boundary. */
function toCallToolResult(result: RuntimeResult<unknown>): CallToolResult {
  const payload = result.success ? result.value : result.error;
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: !result.success };
}

/** Wrap a handler so no exception escapes the MCP boundary (App. A.11). */
function guarded(handler: () => Promise<RuntimeResult<unknown>> | RuntimeResult<unknown>): () => Promise<CallToolResult> {
  return async () => {
    try {
      return toCallToolResult(await handler());
    } catch (error) {
      return toCallToolResult({
        success: false,
        error: duskError("internal_error", error instanceof Error ? error.message : "unknown error", { recoverable: false }),
      });
    }
  };
}

function resourceContents(uri: URL, result: RuntimeResult<unknown>) {
  const payload = result.success ? result.value : result.error;
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(payload) }] };
}

export const PHASE3_WRITE_TOOL_NAMES = ["dusk_implement", "dusk_cancel", "dusk_resolve_livelock", "dusk_test"] as const;

export const PHASE4_AUTHOR_TOOL_NAMES = ["dusk_author_start", "dusk_author_continue", "dusk_author_finalize"] as const;

/** Build the Dusk MCP server. The read-only Phase-2 surface is always present
 *  (Phase 4 extends it with dusk_list_dialogs ↔ dusk://dialogs/active); the
 *  Phase-3 write surface is registered when `write` deps are supplied; the
 *  Phase-4 author surface (dusk_author_* / /dusk-author) when `author` deps are. */
export function createDuskMcpServer(ctx: DuskContext, write?: WriteSurfaceDeps, author?: AuthorSurfaceDeps): McpServer {
  const server = new McpServer({ name: "dusk", version: "0.0.1" });

  server.registerTool("dusk_status", { description: "Current state: active beads, recent verdicts, recent test runs, index stats.", inputSchema: {} }, guarded(() => statusQuery(ctx)));

  server.registerTool(
    "dusk_inspect",
    { description: "Read-only query: hierarchical satisfaction, claim lists, low-confidence supports.", inputSchema: { scope: z.union([z.string(), z.array(z.string())]) } },
    (args) => guarded(() => inspectQuery(ctx, args.scope))(),
  );

  server.registerTool(
    "dusk_verify",
    { description: "Run the Verifier procedure read-only over a scope/intents and return per-intent Verdicts.", inputSchema: { scope: z.union([z.string(), z.array(z.string())]).optional(), intents: z.array(z.string()).optional(), diff: z.unknown().optional() } },
    (args) => guarded(() => verifyQuery(ctx, args))(),
  );

  server.registerTool("dusk_list_intents", { description: "List all intents (path, description, obligation).", inputSchema: {} }, guarded(() => listIntentsQuery(ctx)));

  server.registerTool(
    "dusk_get_intent",
    { description: "Get one intent by path.", inputSchema: { path: z.string() } },
    (args) => guarded(() => getIntentQuery(ctx, args.path))(),
  );

  server.registerTool(
    "dusk_list_traces",
    { description: "Recent SubAgentTrace events.", inputSchema: { limit: z.number().int().positive().optional(), since: z.string().optional() } },
    (args) => guarded(() => listTracesQuery(ctx, { limit: args.limit }))(),
  );

  server.registerTool("dusk_list_beads", { description: "Active bead summaries.", inputSchema: {} }, guarded(() => listBeadsQuery(ctx)));

  server.registerTool(
    "dusk_get_bead",
    { description: "Bead memory + verdict history.", inputSchema: { bead_id: z.string() } },
    (args) => guarded(() => getBeadQuery(ctx, args.bead_id))(),
  );

  server.registerTool("dusk_list_implement_checkpoints", { description: "Outstanding paused-pipeline checkpoints.", inputSchema: {} }, guarded(() => listCheckpointsQuery(ctx)));

  server.registerTool("dusk_list_dialogs", { description: "Outstanding Author dialogs (dialog_id, request, current_stage, timestamps).", inputSchema: {} }, guarded(() => listDialogsQuery(ctx.rootDir)));

  // Resources mirroring the paired tools (same shared query functions).
  server.registerResource("intents", "dusk://intents", { description: "All intents" }, async (uri) => resourceContents(uri, listIntentsQuery(ctx)));
  server.registerResource("traces", "dusk://traces/recent", { description: "Recent traces" }, async (uri) => resourceContents(uri, listTracesQuery(ctx)));
  server.registerResource("beads", "dusk://beads/active", { description: "Active beads" }, async (uri) => resourceContents(uri, listBeadsQuery(ctx)));
  server.registerResource("checkpoints", "dusk://implement-checkpoints", { description: "Implement checkpoints" }, async (uri) => resourceContents(uri, listCheckpointsQuery(ctx)));
  server.registerResource("dialogs", "dusk://dialogs/active", { description: "Outstanding Author dialogs" }, async (uri) => resourceContents(uri, listDialogsQuery(ctx.rootDir)));
  server.registerResource(
    "intent",
    new ResourceTemplate("dusk://intents/{+path}", { list: undefined }),
    { description: "One intent" },
    async (uri, variables) => resourceContents(uri, getIntentQuery(ctx, String(variables.path))),
  );
  server.registerResource(
    "bead",
    new ResourceTemplate("dusk://beads/{id}", { list: undefined }),
    { description: "One bead" },
    async (uri, variables) => resourceContents(uri, getBeadQuery(ctx, String(variables.id))),
  );

  // ---- Phase-3 write surface (registered only when write deps are supplied). ----
  if (write) {
    server.registerTool(
      "dusk_implement",
      { description: "Run the 9-step implementation pipeline (request or resume_token).", inputSchema: { request: z.string().optional(), resume_token: z.string().optional(), scope_hint: z.array(z.string()).optional() } },
      (args) => guarded(() => duskImplement(write, { request: args.request, resumeToken: args.resume_token, scopeHint: args.scope_hint }))(),
    );
    server.registerTool(
      "dusk_cancel",
      { description: "Cooperatively cancel an in-flight pipeline; returns a CancelResult.", inputSchema: { bead_id: z.string().optional(), reason: z.string() } },
      (args) => guarded(() => duskCancel(write, args))(),
    );
    server.registerTool(
      "dusk_resolve_livelock",
      {
        description: "Resolve a Test-Verifier livelock (accept_test_as_is | modify_triple | escalate). modify_triple opens a scoped Author dialog (Phase-4 contract; the Phase-3 inline payload form is rejected).",
        // `payload` stays declared ONLY so Phase-3-form callers reach the typed config_invalid rejection instead of a transport error.
        inputSchema: {
          bead_id: z.string(),
          verb: z.enum(["accept_test_as_is", "modify_triple", "escalate"]),
          dialog_init: z.record(z.unknown()).optional(),
          payload: z
            .record(z.unknown())
            .optional()
            .describe("REMOVED in Phase 4 — passing any value returns DuskError{kind: config_invalid}; use dialog_init instead"),
        },
      },
      (args) => guarded(() => duskResolveLivelock(write, args as never))(),
    );
    server.registerTool(
      "dusk_test",
      { description: "Run the Test Runner standalone over a test-intent scope; returns a TestVerdict.", inputSchema: { scope: z.string() } },
      (args) => guarded(() => duskTest(write, args.scope))(),
    );
  }

  // ---- Phase-4 author surface (registered only when author deps are supplied). ----
  if (author) {
    server.registerTool(
      "dusk_author_start",
      {
        description: "Open an intent-authoring dialog (RFC §5). entry_mode: full (Stage 1) | scoped_triple_edit (Stage 4, failing triple pre-loaded) | l2_recovery (Stage 3, proposal injected). Returns {dialog_id, stage, next_question}.",
        inputSchema: { request: z.string(), entry_mode: z.string().optional(), dialog_init: z.record(z.unknown()).optional() },
      },
      (args) => guarded(() => duskAuthorStart(author, args))(),
    );
    server.registerTool(
      "dusk_author_continue",
      {
        description: "Advance an authoring dialog one turn. Returns {stage, next_question} or {finalize_ready: true}.",
        inputSchema: { dialog_id: z.string(), response: z.string(), payload: z.record(z.unknown()).optional() },
      },
      (args) => guarded(() => duskAuthorContinue(author, args))(),
    );
    server.registerTool(
      "dusk_author_finalize",
      {
        description: "Atomically commit every drafted intent and destroy the dialog. Returns {intents_created[]}.",
        inputSchema: { dialog_id: z.string() },
      },
      (args) => guarded(() => duskAuthorFinalize(author, args))(),
    );
  }

  return server;
}
