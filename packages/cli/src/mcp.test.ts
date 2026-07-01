import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTempRepo, type TempRepo } from "@dusk/test-harness";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildDuskServer } from "./mcp.js";

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
});
afterEach(() => repo.cleanup());

describe("dusk mcp — the stdio launcher builds a connectable server", () => {
  test("read-only build advertises the dusk_* read tools over an in-memory transport", async () => {
    // readOnly skips the ambient-CLI write/author wiring — pure, zero-model.
    const server = buildDuskServer(repo.dir, { readOnly: true });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const tools = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ["dusk_status", "dusk_inspect", "dusk_list_intents", "dusk_list_traces"]) {
      expect(tools).toContain(name);
    }

    // dusk_status answers over the transport on an idle project.
    const status = await client.callTool({ name: "dusk_status", arguments: {} });
    expect((status as { isError?: boolean }).isError).toBeFalsy();

    await client.close();
  });
});
