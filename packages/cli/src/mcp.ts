import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createDuskMcpServer,
  loadProjectContext,
  type AuthorSurfaceDeps,
  type WriteSurfaceDeps,
} from "@dusk/mcp-server";
import {
  DEFAULT_VERIFIER_SYSTEM_PROMPT,
  claudeCodeAvailable,
  claudeCodeModelClient,
  type ModelClient,
} from "@dusk/runtime-verifier";
import { withTransportRetry } from "@dusk/runtime-benchmark";

import { buildImplementDeps } from "./implement.js";
import { buildAmbientRuntime } from "./author.js";

/**
 * `dusk mcp` — start the Dusk MCP server over stdio so an MCP host (Claude Code,
 * etc.) can call the `dusk_*` tools directly. This is the long-running front door
 * over the same engine the one-shot CLI commands mirror: it reuses `dusk
 * implement`'s `buildImplementDeps` and `dusk author`'s `buildAmbientRuntime`, so
 * the served tools and the CLI commands drive identical wiring.
 *
 * The read-only surface (status / inspect / list_* / get_*) is always served. The
 * write surface (dusk_implement / dusk_cancel / dusk_resolve_livelock / dusk_test)
 * and the author surface (dusk_author_*) need the ambient `claude` CLI on PATH and
 * a git repo; when either is missing the server degrades to read-only and says so
 * on STDERR — never silently, and never on STDOUT (the JSON-RPC channel).
 */

export const MCP_HELP = `dusk mcp
  Start the Dusk MCP server over stdio (JSON-RPC on stdin/stdout; logs on stderr).
  Serves the dusk_* tools so an MCP host can drive the engine directly — the
  long-running counterpart to the one-shot CLI commands.

  The read-only tools always serve. dusk_implement / dusk_author_* additionally
  need the ambient \`claude\` CLI on PATH and a git repo; without them the server
  degrades to read-only (noted on stderr).

  Register it with an MCP host by pointing at the built entry, e.g. .mcp.json:
    { "mcpServers": { "dusk": {
        "command": "node",
        "args": ["<abs>/packages/cli/dist/cli.js", "mcp"] } } }
`;

export type McpServerOptions = {
  clock?: { now: () => number };
  /** Injectable for tests: when supplied, the write/author surfaces are skipped
   *  and the read-only surface is served without touching the ambient CLI. */
  readOnly?: boolean;
};

/** Build the Dusk MCP server for `root`, attaching the write + author surfaces
 *  when the environment supports them. Pure construction — issues no model calls. */
export function buildDuskServer(root: string, opts: McpServerOptions = {}): McpServer {
  const clock = opts.clock ?? { now: () => Date.now() };

  if (opts.readOnly || !claudeCodeAvailable()) {
    if (!opts.readOnly) {
      process.stderr.write(
        "dusk mcp: `claude` not on PATH — serving read-only tools; dusk_implement / dusk_verify / dusk_author_* are disabled.\n",
      );
    }
    return createDuskMcpServer(loadProjectContext(root));
  }

  const rawModelClient = claudeCodeModelClient({ model: "claude-sonnet-4-6" });
  const modelClient: ModelClient = { complete: (req) => withTransportRetry(() => rawModelClient.complete(req)) };
  const ctx = loadProjectContext(root, { modelClient, systemPrompt: DEFAULT_VERIFIER_SYSTEM_PROMPT });

  try {
    const runtime = buildAmbientRuntime(root, clock);
    const write: WriteSurfaceDeps = {
      ...buildImplementDeps(root, { clock }),
      authorRuntime: runtime,
      livelockReports: new Map(),
    };
    const author: AuthorSurfaceDeps = { runtime };
    return createDuskMcpServer(ctx, write, author);
  } catch (error) {
    // The write surface needs a git repo (worktree resolution). Outside one,
    // fall back to read-only rather than failing the whole server to start.
    process.stderr.write(
      `dusk mcp: write/author surface unavailable (${error instanceof Error ? error.message : String(error)}) — serving read-only.\n`,
    );
    return createDuskMcpServer(ctx);
  }
}

/** Start the server on stdio and resolve when the transport closes (stdin EOF). */
export async function runMcpServer(root: string, opts: McpServerOptions = {}): Promise<number> {
  const server = buildDuskServer(root, opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("dusk mcp: connected over stdio (stdin EOF or SIGINT to stop)\n");
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
  return 0;
}
