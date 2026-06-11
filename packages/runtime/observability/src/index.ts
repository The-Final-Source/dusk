// @dusk/runtime-observability — trace ring buffer (design D3) + out-of-band
// mirror forwarders (design D4). The pipeline's only I/O obligation is the
// local file append; mirrors tail the file and structurally cannot block a run.
export {
  appendTraceRotating,
  snapshotTraceBoundaries,
  tracePath,
  rotatedTracePath,
  DEFAULT_TRACE_RING_BYTES,
  type TraceWindowSnapshot,
} from "./ringBuffer.js";
export {
  runForwarderOnce,
  startForwarder,
  startConfiguredForwarders,
  cursorPath,
  otlpSink,
  postHogSink,
  type ForwarderHandle,
  type ForwarderOptions,
  type MirrorSink,
} from "./forwarder.js";
