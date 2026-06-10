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

/** Build the Dusk MCP server (read-only Phase-2 surface) over a loaded context. */
export function createDuskMcpServer(ctx: DuskContext): McpServer {
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

  // Resources mirroring the paired tools (same shared query functions).
  server.registerResource("intents", "dusk://intents", { description: "All intents" }, async (uri) => resourceContents(uri, listIntentsQuery(ctx)));
  server.registerResource("traces", "dusk://traces/recent", { description: "Recent traces" }, async (uri) => resourceContents(uri, listTracesQuery(ctx)));
  server.registerResource("beads", "dusk://beads/active", { description: "Active beads" }, async (uri) => resourceContents(uri, listBeadsQuery(ctx)));
  server.registerResource("checkpoints", "dusk://implement-checkpoints", { description: "Implement checkpoints" }, async (uri) => resourceContents(uri, listCheckpointsQuery(ctx)));
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

  return server;
}
