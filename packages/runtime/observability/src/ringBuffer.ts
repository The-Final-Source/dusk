import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { DEFAULT_TRACE_RING_BYTES, rotatedTracePath, tracePath, type SubAgentTrace } from "@dusk/core-schema";

/**
 * `traces.jsonl` ring buffer — Phase 5 design D3. The trace file rotates when it
 * exceeds the configured byte ceiling: `traces.jsonl` → `traces.1.jsonl` (one
 * prior generation kept; rename, NEVER truncate-in-place) and a fresh file
 * starts. POSIX rename semantics keep an open read handle on the renamed file
 * valid, so an in-flight audit/benchmark reader's window survives rotation.
 *
 * The path layout is the SSoT in `@dusk/core-schema` (iaPaths) so the readers
 * (MCP, benchmark) resolve the same file this writer rotates; re-exported here
 * for existing call sites.
 */

export { DEFAULT_TRACE_RING_BYTES, rotatedTracePath, tracePath };

/**
 * Append one trace event, rotating when the file exceeds the ring ceiling.
 * Rotation is rename-based: the current file becomes `traces.1.jsonl`
 * (replacing any prior generation) and subsequent events land in a fresh file.
 */
export function appendTraceRotating(rootDir: string, trace: SubAgentTrace, opts: { ringBytes?: number } = {}): void {
  const ringBytes = opts.ringBytes ?? DEFAULT_TRACE_RING_BYTES;
  const path = tracePath(rootDir);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(trace)}\n`, "utf8");
  if (statSync(path).size > ringBytes) {
    renameSync(path, rotatedTracePath(rootDir)); // replaces the prior generation
  }
}

export type TraceWindowSnapshot = {
  /** Read the consistent window captured at snapshot time (rotation-safe). */
  read: () => SubAgentTrace[];
  /** Release the held file handles. */
  close: () => void;
};

function readHeld(fd: number, bytes: number): string {
  const buffer = Buffer.alloc(bytes);
  let offset = 0;
  while (offset < bytes) {
    const n = readSync(fd, buffer, offset, bytes - offset, offset);
    if (n === 0) break;
    offset += n;
  }
  return buffer.subarray(0, offset).toString("utf8");
}

function parseLines(text: string): SubAgentTrace[] {
  const out: SubAgentTrace[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line) as SubAgentTrace);
    } catch {
      // A partial trailing line (append in flight at snapshot time) is not part
      // of the consistent window.
    }
  }
  return out;
}

/**
 * Snapshot the trace-file boundaries for an audit/benchmark run: open handles
 * on every existing generation and record their byte lengths. A rotation firing
 * mid-read cannot drop events from under the reader — the renamed file stays
 * readable through the held handle (D3 audit pinning).
 */
export function snapshotTraceBoundaries(rootDir: string): TraceWindowSnapshot {
  const held: Array<{ fd: number; bytes: number }> = [];
  for (const path of [rotatedTracePath(rootDir), tracePath(rootDir)]) {
    if (!existsSync(path)) continue;
    const fd = openSync(path, "r");
    held.push({ fd, bytes: fstatSync(fd).size });
  }
  let closed = false;
  return {
    read: () => held.flatMap(({ fd, bytes }) => parseLines(readHeld(fd, bytes))),
    close: () => {
      if (closed) return;
      closed = true;
      for (const { fd } of held) closeSync(fd);
    },
  };
}
