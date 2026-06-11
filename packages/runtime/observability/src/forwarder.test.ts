import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SubAgentTrace } from "@dusk/core-schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cursorPath, otlpSink, postHogSink, runForwarderOnce, type MirrorSink } from "./forwarder.js";
import { appendTraceRotating, tracePath } from "./ringBuffer.js";

// 2.3 — out-of-band file-tail forwarders (design D4; P5-T12). Zero-model + real
// fs + a mocked unreachable sink (the one unmanaged dependency).

const trace = (n: number): SubAgentTrace => ({
  schema_version: 1,
  trace_id: `tr_${String(n).padStart(4, "0")}`,
  role: "engineer",
  invocation_site: "short-cycle",
  model: "test",
  prompt_tokens: 0,
  completion_tokens: 0,
  latency_ms: 0,
  cost_usd: 0,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dusk-fwd-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const recordingSink = (name = "rec"): MirrorSink & { received: string[][] } => {
  const received: string[][] = [];
  return {
    name,
    received,
    send: async (lines) => {
      received.push(lines);
    },
  };
};

describe("an unreachable sink does not lose or block the local stream", () => {
  it("traces.jsonl stays complete; the failed batch is retried (cursor unmoved); the writer never awaits the sink", async () => {
    for (let n = 1; n <= 3; n += 1) appendTraceRotating(dir, trace(n));

    const unreachable = otlpSink("http://127.0.0.1:1/v1/logs", {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    await expect(runForwarderOnce(dir, unreachable)).rejects.toThrow("ECONNREFUSED");

    // The local stream is the source of truth and is untouched by sink failure.
    const lines = readFileSync(tracePath(dir), "utf8").split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(3);
    // The cursor did NOT advance — at-least-once delivery retries the batch.
    expect(existsSync(cursorPath(dir, "otlp"))).toBe(false);

    // Writers keep appending with the sink down (the emission path never awaits a sink).
    appendTraceRotating(dir, trace(4));
    expect(readFileSync(tracePath(dir), "utf8").split("\n").filter((l) => l.trim().length > 0)).toHaveLength(4);
  });
});

describe("a restarted forwarder resumes from its cursor", () => {
  it("forwards each line exactly once across forwarder instances", async () => {
    for (let n = 1; n <= 2; n += 1) appendTraceRotating(dir, trace(n));

    const first = recordingSink();
    const r1 = await runForwarderOnce(dir, first);
    expect(r1.forwarded).toBe(2);

    for (let n = 3; n <= 4; n += 1) appendTraceRotating(dir, trace(n));

    // A NEW instance (fresh process) with the same sink name resumes from the cursor.
    const second = recordingSink();
    const r2 = await runForwarderOnce(dir, second);
    expect(r2.forwarded).toBe(2);
    const ids = second.received.flat().map((l) => (JSON.parse(l) as SubAgentTrace).trace_id);
    expect(ids).toEqual(["tr_0003", "tr_0004"]); // no re-send of tr_0001/tr_0002
  });

  it("drains a rotated generation before the fresh file (at-least-once across rotation)", async () => {
    const ringBytes = JSON.stringify(trace(0)).length * 2; // rotate after ~2 events
    appendTraceRotating(dir, trace(1), { ringBytes });
    const sink = recordingSink();
    await runForwarderOnce(dir, sink);

    appendTraceRotating(dir, trace(2), { ringBytes }); // crosses the ceiling → rotation
    appendTraceRotating(dir, trace(3), { ringBytes });

    await runForwarderOnce(dir, sink);
    const ids = sink.received.flat().map((l) => (JSON.parse(l) as SubAgentTrace).trace_id);
    expect(ids).toEqual(["tr_0001", "tr_0002", "tr_0003"]);
  });
});

describe("sink adapters", () => {
  it("otlp posts a logs envelope; posthog posts a batch — both over the same tail-cursor machinery", async () => {
    appendTraceRotating(dir, trace(1));

    const posts: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = async (url: string, init: { body: string }) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200 };
    };

    await runForwarderOnce(dir, otlpSink("http://collector/v1/logs", { fetchImpl }));
    await runForwarderOnce(dir, postHogSink("http://posthog/batch", { apiKey: "k", fetchImpl }));

    const otlpBody = posts[0].body as { resourceLogs: Array<{ scopeLogs: Array<{ logRecords: unknown[] }> }> };
    expect(otlpBody.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);
    const phBody = posts[1].body as { api_key: string; batch: unknown[] };
    expect(phBody.batch).toHaveLength(1);
  });
});
