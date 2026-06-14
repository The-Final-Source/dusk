import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { traceCursorPath, type MirrorConfig } from "@dusk/core-schema";

import { rotatedTracePath, tracePath } from "./ringBuffer.js";

/** Cursor-file path for a sink — the layout SSoT lives in `@dusk/core-schema`. */
export const cursorPath = traceCursorPath;

/**
 * Out-of-band mirror forwarders — Phase 5 design D4 (P5-T12). Forwarders TAIL
 * `traces.jsonl`; they are not hooks in the trace-emission path. The pipeline's
 * only I/O obligation is the local file append, so an unreachable, slow, or
 * crashed sink structurally cannot block a run — there is no await to block on.
 *
 * Each forwarder keeps a cursor file (`.ia/observability/.cursor-<sink>`) so a
 * restart resumes without re-sending from zero. Delivery is at-least-once (the
 * cursor advances only after a successful send); the sink's own idempotency is
 * the dedupe layer.
 */

export type MirrorSink = {
  /** Cursor-file key — one cursor per sink. */
  name: string;
  /** Deliver a batch of raw JSONL lines. Throws on failure (the batch is retried next tick). */
  send: (lines: string[]) => Promise<void>;
};

type Cursor = {
  /** Byte offset into the CURRENT `traces.jsonl` generation. */
  offset: number;
  /** Inode of the generation the offset refers to — rename-based rotation detection. */
  ino?: number;
};

function readCursor(rootDir: string, sinkName: string): Cursor {
  const path = cursorPath(rootDir, sinkName);
  if (!existsSync(path)) return { offset: 0 };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Cursor;
  } catch {
    return { offset: 0 };
  }
}

function writeCursor(rootDir: string, sinkName: string, cursor: Cursor): void {
  const path = cursorPath(rootDir, sinkName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cursor), "utf8");
}

/** Read complete lines from `path` starting at byte `from`; returns the lines + the new offset. */
function readNewLines(path: string, from: number): { lines: string[]; offset: number } {
  if (!existsSync(path)) return { lines: [], offset: from };
  const size = statSync(path).size;
  if (size <= from) return { lines: [], offset: from };
  const fd = openSync(path, "r");
  try {
    const bytes = fstatSync(fd).size - from;
    const buffer = Buffer.alloc(bytes);
    let read = 0;
    while (read < bytes) {
      const n = readSync(fd, buffer, read, bytes - read, from + read);
      if (n === 0) break;
      read += n;
    }
    const text = buffer.subarray(0, read).toString("utf8");
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline < 0) return { lines: [], offset: from }; // no complete line yet
    const complete = text.slice(0, lastNewline);
    return { lines: complete.split("\n").filter((l) => l.trim().length > 0), offset: from + Buffer.byteLength(complete, "utf8") + 1 };
  } finally {
    closeSync(fd);
  }
}

/**
 * One tail tick: drain new complete lines past the cursor and deliver them.
 * On rotation (current file shrank below the cursor), the remainder of the
 * rotated generation is drained first, then the fresh file from zero.
 * The cursor advances ONLY after a successful send (at-least-once).
 */
export async function runForwarderOnce(rootDir: string, sink: MirrorSink): Promise<{ forwarded: number }> {
  const cursor = readCursor(rootDir, sink.name);
  const current = tracePath(rootDir);
  const currentStat = existsSync(current) ? statSync(current) : null;

  let forwarded = 0;
  const rotationHappened = cursor.ino !== undefined && (currentStat === null || currentStat.ino !== cursor.ino);
  if (rotationHappened) {
    // Finish the rotated generation from the old offset before the fresh file.
    const rotated = readNewLines(rotatedTracePath(rootDir), cursor.offset);
    if (rotated.lines.length > 0) {
      await sink.send(rotated.lines);
      forwarded += rotated.lines.length;
    }
    cursor.offset = 0;
    delete cursor.ino;
    writeCursor(rootDir, sink.name, cursor);
  }

  if (currentStat) {
    const fresh = readNewLines(current, cursor.offset);
    if (fresh.lines.length > 0) {
      await sink.send(fresh.lines);
      forwarded += fresh.lines.length;
      writeCursor(rootDir, sink.name, { offset: fresh.offset, ino: currentStat.ino });
    }
  }
  return { forwarded };
}

export type ForwarderHandle = { stop: () => void };

export type ForwarderOptions = {
  /** Poll interval for the tail loop (default 1000 ms). */
  intervalMs?: number;
  /** Out-of-band failure visibility — never propagated to the pipeline. */
  onError?: (error: unknown) => void;
};

/**
 * Start the out-of-band tail loop. Errors are visible only via `onError`
 * (default: stderr) — a failing sink retries the same batch on the next tick
 * and never surfaces into any pipeline result.
 */
export function startForwarder(rootDir: string, sink: MirrorSink, opts: ForwarderOptions = {}): ForwarderHandle {
  const onError = opts.onError ?? ((e: unknown) => process.stderr.write(`[dusk mirror ${sink.name}] ${String(e)}\n`));
  const timer = setInterval(() => {
    void runForwarderOnce(rootDir, sink).catch(onError);
  }, opts.intervalMs ?? 1_000);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

/**
 * Start one forwarder per configured mirror (`dusk.config.yml >
 * observability.mirrors[]`) — called by the long-running MCP server process.
 * Timers are unref'd: forwarders never keep the process alive, and a sink
 * failure surfaces only through `opts.onError`.
 */
export function startConfiguredForwarders(
  rootDir: string,
  mirrors: MirrorConfig[],
  opts: ForwarderOptions = {},
): ForwarderHandle[] {
  return mirrors.map((mirror) =>
    startForwarder(rootDir, mirror.sink === "otlp" ? otlpSink(mirror.endpoint) : postHogSink(mirror.endpoint), opts),
  );
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

/** OTLP/HTTP JSON logs sink — each trace line becomes one log record body. */
export function otlpSink(endpoint: string, opts: { fetchImpl?: FetchLike } = {}): MirrorSink {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    name: "otlp",
    send: async (lines) => {
      const body = JSON.stringify({
        resourceLogs: [
          {
            resource: { attributes: [{ key: "service.name", value: { stringValue: "dusk" } }] },
            scopeLogs: [{ scope: { name: "dusk.traces" }, logRecords: lines.map((line) => ({ body: { stringValue: line } })) }],
          },
        ],
      });
      const res = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (!res.ok) throw new Error(`otlp sink responded ${res.status}`);
    },
  };
}

/** PostHog sink — a thin adapter over the same tail-cursor machinery (design Q3). */
export function postHogSink(endpoint: string, opts: { apiKey?: string; fetchImpl?: FetchLike } = {}): MirrorSink {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    name: "posthog",
    send: async (lines) => {
      const body = JSON.stringify({
        api_key: opts.apiKey ?? "",
        batch: lines.map((line) => ({ event: "dusk_sub_agent_trace", properties: { raw: line } })),
      });
      const res = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (!res.ok) throw new Error(`posthog sink responded ${res.status}`);
    },
  };
}
