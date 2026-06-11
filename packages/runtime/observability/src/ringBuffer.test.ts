import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SubAgentTrace } from "@dusk/core-schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendTraceRotating, rotatedTracePath, snapshotTraceBoundaries, tracePath } from "./ringBuffer.js";

// 2.2 — ring buffer (design D3). Zero-model + real fs.

const trace = (n: number): SubAgentTrace => ({
  schema_version: 1,
  trace_id: `tr_${String(n).padStart(4, "0")}`,
  role: "verifier",
  invocation_site: "short-cycle",
  model: "test",
  prompt_tokens: 0,
  completion_tokens: 0,
  latency_ms: 0,
  cost_usd: 0,
});

const lineBytes = JSON.stringify(trace(0)).length + 1;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dusk-ring-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const idsIn = (path: string): string[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => (JSON.parse(l) as SubAgentTrace).trace_id);

describe("exceeding the ring ceiling rotates exactly one generation", () => {
  it("renames traces.jsonl → traces.1.jsonl and starts a fresh file; a second rotation replaces the prior generation", () => {
    const ringBytes = lineBytes * 3; // rotate after the 4th event
    for (let n = 1; n <= 4; n += 1) appendTraceRotating(dir, trace(n), { ringBytes });

    expect(existsSync(rotatedTracePath(dir))).toBe(true);
    const firstGeneration = idsIn(rotatedTracePath(dir));
    expect(firstGeneration).toEqual(["tr_0001", "tr_0002", "tr_0003", "tr_0004"]);
    expect(existsSync(tracePath(dir))).toBe(false); // fresh file starts on next append

    // Post-rotation events land in the fresh traces.jsonl.
    appendTraceRotating(dir, trace(5), { ringBytes });
    expect(idsIn(tracePath(dir))).toEqual(["tr_0005"]);

    // A second rotation REPLACES the prior generation (exactly one kept).
    for (let n = 6; n <= 8; n += 1) appendTraceRotating(dir, trace(n), { ringBytes });
    expect(idsIn(rotatedTracePath(dir))).toEqual(["tr_0005", "tr_0006", "tr_0007", "tr_0008"]);
    expect(existsSync(join(dir, ".ia/observability/traces.2.jsonl"))).toBe(false);
  });
});

describe("rotation preserves an in-flight reader's window", () => {
  it("a snapshot taken before rotation reads its complete window through held handles", () => {
    const ringBytes = lineBytes * 100; // no rotation during setup
    for (let n = 1; n <= 5; n += 1) appendTraceRotating(dir, trace(n), { ringBytes });

    const snapshot = snapshotTraceBoundaries(dir);

    // Rotation fires mid-read: tiny ceiling forces an immediate rename.
    appendTraceRotating(dir, trace(6), { ringBytes: 1 });
    expect(existsSync(rotatedTracePath(dir))).toBe(true);
    appendTraceRotating(dir, trace(7), { ringBytes: lineBytes * 100 });

    // The snapshot's window is complete (the renamed file is still readable
    // through the held handle) and excludes post-snapshot events.
    const window = snapshot.read().map((t) => t.trace_id);
    expect(window).toEqual(["tr_0001", "tr_0002", "tr_0003", "tr_0004", "tr_0005"]);
    snapshot.close();

    // Post-rotation events landed in the fresh traces.jsonl.
    expect(idsIn(tracePath(dir))).toEqual(["tr_0007"]);
  });
});
