import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildDerivedIndex } from "@dusk/core-index";
import { loadWorkedExample } from "@dusk/fixtures";
import { createTempRepo, type TempRepo } from "@dusk/test-harness";
import type { Verdict } from "@dusk/core-schema";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildContext, type DuskContext } from "./context.js";
import { inspectQuery, listIntentsQuery, statusQuery } from "./queries.js";
import { PHASE2_RESOURCE_URIS, PHASE2_TOOL_NAMES, createDuskMcpServer } from "./server.js";

let repo: TempRepo;
beforeEach(() => {
  repo = createTempRepo({ git: false });
});
afterEach(() => repo.cleanup());

function workedContext(): DuskContext {
  const wx = loadWorkedExample();
  return buildContext({ rootDir: repo.dir, index: wx.index, intents: wx.intents, readFile: wx.readFile });
}

async function connect(ctx: DuskContext): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createDuskMcpServer(ctx);
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

const parse = (res: unknown): unknown => {
  const content = (res as { content: Array<{ text?: string }> }).content;
  return JSON.parse(content[0].text ?? "null");
};

describe("6.1 — the MCP server starts and lists the Phase-2 tools + resources", () => {
  test("advertised tools and resources match exactly (Phase-4 adds dusk_list_dialogs + dusk://dialogs/active)", async () => {
    const client = await connect(workedContext());
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([...PHASE2_TOOL_NAMES, "dusk_list_dialogs"].sort());
    const resources = (await client.listResources()).resources.map((r) => r.uri);
    for (const uri of [...PHASE2_RESOURCE_URIS, "dusk://dialogs/active"]) expect(resources).toContain(uri);
  });
});

describe("9.1 — dusk://dialogs/active and dusk_list_dialogs agree over the transport", () => {
  test("resource and paired tool return structurally equivalent dialog listings", async () => {
    const ctx = workedContext();
    const client = await connect(ctx);
    const viaTool = parse(await client.callTool({ name: "dusk_list_dialogs", arguments: {} })) as { dialogs: unknown[] };
    const resource = await client.readResource({ uri: "dusk://dialogs/active" });
    const viaResource = JSON.parse((resource.contents[0] as { text: string }).text) as { dialogs: unknown[] };
    expect(viaTool).toEqual(viaResource);
    expect(viaTool).toEqual({ dialogs: [] });
  });
});

describe("6.2 / P2-T20 — dusk_status on an idle system", () => {
  test("empty collections + index_stats reflecting the loaded index", () => {
    const idle = buildContext({ rootDir: repo.dir, index: buildDerivedIndex([], new Map()), intents: new Map(), readFile: () => "" });
    const result = statusQuery(idle);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.active_beads).toEqual([]);
    expect(result.value.recent_verdicts).toEqual([]);
    expect(result.value.index_stats).toEqual({ intents: 0, decorations: 0 });

    const wx = statusQuery(workedContext());
    if (wx.success) {
      expect(wx.value.index_stats.intents).toBeGreaterThan(0);
      expect(wx.value.index_stats.decorations).toBeGreaterThan(0);
    }
  });
});

describe("6.3 / P2-T11 — dusk_inspect mirrors the index and surfaces low-confidence supports", () => {
  test("inspect on the App. B fixture; unit-tests child unsatisfied until test code exists", () => {
    const ctx = workedContext();
    const result = inspectQuery(ctx, "notifications/send");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.claims.length).toBeGreaterThan(0);
    expect(result.value.support_claims.length).toBeGreaterThan(0);
    const child = result.value.test_intents.find((t) => t.path === "notifications/send/unit-tests");
    expect(child?.satisfied).toBe(false);
  });

  test("P2-T8 consumer half — a low-confidence verdict surfaces in low_confidence_supports", () => {
    const ctx = workedContext();
    const verdict: Verdict = {
      intent_path: "notifications/send",
      decision: "accept",
      per_triple: [
        {
          triple_id: "persist-first",
          focal_verdict: "pass",
          support_quality: "low_confidence",
          polarity: "positive",
          evidence: {
            support_claims: [
              { file: "x.ts", lines: [1, 1], quote: "const rows = ...", support_triple: ["the row builder", "deletes", "rows"], triple_verdict: "mismatch" },
            ],
          },
          rationale: "",
        },
      ],
      aggregate_rationale: "",
    };
    ctx.verdictStore.set("notifications/send", verdict);
    const result = inspectQuery(ctx, "notifications/send");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.low_confidence_supports).toHaveLength(1);
    expect(result.value.low_confidence_supports[0].triple_verdict).toBe("mismatch");
    expect(result.value.low_confidence_supports[0].aspect_id).toBe("persist-first");
  });
});

describe("6.5 / P2-T13 — resources and paired tools return structurally equivalent data", () => {
  test("dusk://intents and dusk_list_intents agree on intent ids + fields", async () => {
    const ctx = workedContext();
    const client = await connect(ctx);
    const viaTool = parse(await client.callTool({ name: "dusk_list_intents", arguments: {} })) as { intents: { path: string }[] };
    const resource = await client.readResource({ uri: "dusk://intents" });
    const viaResource = JSON.parse((resource.contents[0] as { text: string }).text) as { intents: { path: string }[] };

    const toolIds = viaTool.intents.map((i) => i.path).sort();
    const resourceIds = viaResource.intents.map((i) => i.path).sort();
    expect(toolIds).toEqual(resourceIds);
    expect(toolIds).toEqual(listIntentsQuery(ctx).success ? (listIntentsQuery(ctx) as { value: { intents: { path: string }[] } }).value.intents.map((i) => i.path).sort() : []);
  });
});

describe("6.4 / P2-T12 — dusk_verify is read-only and mutates no state", () => {
  test("verifying mutates no working-tree state (in-memory verdict store only)", async () => {
    const gitRepo = createTempRepo({ git: true });
    try {
      const wx = loadWorkedExample();
      const ctx = buildContext({
        rootDir: gitRepo.dir,
        index: wx.index,
        intents: wx.intents,
        readFile: wx.readFile,
        modelClient: {
          complete: async () => ({
            text: JSON.stringify({ triples: [{ triple_id: "is-write", affirmative_holds: true, rationale: "", supports: [] }] }),
            usage: { model: "fake", promptTokens: 1, completionTokens: 1, costUsd: 0, latencyMs: 0 },
          }),
        },
      });
      const { execFileSync } = await import("node:child_process");
      const before = execFileSync("git", ["status", "--porcelain"], { cwd: gitRepo.dir }).toString();

      const { verifyQuery } = await import("./queries.js");
      const result = await verifyQuery(ctx, { intents: ["api/idempotency-on-writes"] }); // antecedent-false → vacuous accept, no model call
      expect(result.success).toBe(true);

      const after = execFileSync("git", ["status", "--porcelain"], { cwd: gitRepo.dir }).toString();
      expect(after).toBe(before); // no files written; working tree unchanged
    } finally {
      gitRepo.cleanup();
    }
  });
});

describe("6.6 / P2-T14 — every tool returns a typed DuskError, not a throw", () => {
  test("unresolvable intent path → intent_path_unresolved", async () => {
    const client = await connect(workedContext());
    const res = await client.callTool({ name: "dusk_get_intent", arguments: { path: "nonexistent/intent" } });
    expect(res.isError).toBe(true);
    const error = parse(res as never) as { kind: string; recoverable: boolean };
    expect(error.kind).toBe("intent_path_unresolved");
    expect(error.recoverable).toBe(true);
  });

  test("evidence overflow → verifier_evidence_too_large, no exception escapes", async () => {
    const wx = loadWorkedExample();
    const ctx = buildContext({
      rootDir: repo.dir,
      index: wx.index,
      intents: wx.intents,
      readFile: wx.readFile,
      config: { version: 1, intents: { dir: ".ia/intents" }, test_pyramid: { suffixes: [] }, verifier_evidence_max_lines: 1 } as never,
      modelClient: { complete: async () => ({ text: "{}", usage: { model: "x", promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 0 } }) },
    });
    const client = await connect(ctx);
    const res = await client.callTool({ name: "dusk_verify", arguments: { intents: ["notifications/send"] } });
    expect(res.isError).toBe(true);
    const error = parse(res as never) as { kind: string };
    expect(error.kind).toBe("verifier_evidence_too_large");
  });
});
