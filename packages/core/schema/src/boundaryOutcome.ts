import { z } from "zod";

import { isModelCallFailure, isTransportError } from "./modelCallError.js";

/**
 * The universal three-way boundary outcome (RFC §1.2.1, App. D.34) — the SINGLE
 * vocabulary every model-call leg and opaque-tool-output boundary resolves to.
 * Lives in the `core-schema` leaf (one source of truth; R2/R3), extending
 * `modelCallError.ts`. Pure — no I/O, no runtime imports.
 *
 * `BoundaryOutcome` is an INTERNAL control-flow TS union, NEVER serialized — so
 * it is a `type`, not a Zod schema (decision ②: cut dead surface). Only the
 * pieces that ARE persisted are Zod: `NoVerdictReason` (rides in
 * `DuskError.details.no_verdict_reason`), the error kind `infrastructure_no_verdict`
 * (in `duskError.ts`), and the bead status `paused_infrastructure`
 * (in the orchestrator's `BEAD_STATUSES`).
 *
 * The deterministic core may compute this outcome ONLY from signals it itself
 * authored or that are universal (R1): whether returned bytes parse into Dusk's
 * own schema (`parsedToDuskSchema`), whether the parsed verdict is content-complete
 * (`completenessHeld` — the positive completeness check, never inferred from the
 * absence of a negative), and whether Dusk's OWN timeout fired (`timedOut`). It
 * MUST NOT branch on any toolchain-minted meaning (an exit code as verdict,
 * "output produced" as success, a tool's status vocabulary).
 */

export const NO_VERDICT_REASONS = [
  "empty", // no parseable output at all (0-token, no envelope)
  "unparseable", // output present but did not parse into Dusk's own schema
  "incomplete", // parsed, but the positive completeness check failed (missing triple/support/ran-to-completion)
  "deterministic_limit", // a deterministic model/tool limit (e.g. error_max_turns) — never cold-retried
  "tool_infrastructure", // the tool's own infrastructure failed (reporter crash / OOM / our timeout)
] as const;
export const NoVerdictReasonSchema = z.enum(NO_VERDICT_REASONS);
export type NoVerdictReason = z.infer<typeof NoVerdictReasonSchema>;

export type BoundaryOutcome =
  | { kind: "content" }
  | { kind: "no_verdict"; reason: NoVerdictReason }
  | { kind: "transport" };

/**
 * The classifier GATE (R2) — every boundary routes through this, so the
 * three-way decision is made in exactly one place. Operates only on
 * already-derived universal facts; it NEVER takes a raw exit code or a tool's
 * status string as a branchable field (R1/R4).
 *
 * The thrown-error arm is for the spawn-seam path. The caller is responsible for
 * the honesty bar: a non-model-call throw (a `TypeError`, an assertion — a
 * programming bug) MUST be re-thrown by the caller BEFORE reaching here, never
 * laundered into a `no_verdict`. When `error` is supplied it is therefore assumed
 * already known to be a model-call failure; a stray non-model-call error is
 * treated conservatively as `no_verdict` only as a last resort, but callers
 * SHALL gate on `isModelCallFailure` first.
 */
export function classifyBoundary(input: {
  /** An error thrown by the boundary (already known to be a model-call failure — see doc). */
  error?: unknown;
  /** Did Dusk's OWN timeout fire? (a universal liveness fact) */
  timedOut?: boolean;
  /** Did the returned bytes parse into Dusk's OWN schema? (a universal liveness fact, NOT content) */
  parsedToDuskSchema?: boolean;
  /** Did the positive completeness check hold? (every scoped unit positively present) */
  completenessHeld?: boolean;
}): BoundaryOutcome {
  // Thrown-error path (spawn seam). A two-death `TransportLegFailure` or a
  // deterministic-limit tag is infrastructure (`no_verdict`); a single genuine
  // transport error is `transport` (eligible for the one retry).
  if (input.error !== undefined) {
    const err = input.error;
    if (err instanceof Error && err.name === "TransportLegFailure") {
      return { kind: "no_verdict", reason: "tool_infrastructure" };
    }
    if (err instanceof Error && typeof (err as { duskModelExit?: unknown }).duskModelExit === "string") {
      return { kind: "no_verdict", reason: "deterministic_limit" };
    }
    if (isTransportError(err)) return { kind: "transport" };
    // A model-call failure that is neither tagged nor a two-death transport —
    // surface it as infrastructure rather than content (callers gate on
    // `isModelCallFailure` first, so a programming bug never reaches here).
    if (isModelCallFailure(err)) return { kind: "no_verdict", reason: "tool_infrastructure" };
    return { kind: "no_verdict", reason: "tool_infrastructure" };
  }

  // Our own timeout firing is a universal liveness fact (R1) — infrastructure.
  if (input.timedOut) return { kind: "no_verdict", reason: "tool_infrastructure" };
  // Bytes that did not parse into Dusk's OWN schema — never content.
  if (input.parsedToDuskSchema === false) return { kind: "no_verdict", reason: "unparseable" };
  // Parsed, but the positive completeness check failed — never inferred-content (R8).
  if (input.completenessHeld === false) return { kind: "no_verdict", reason: "incomplete" };
  return { kind: "content" };
}

/** True iff the outcome is the content path (the only outcome that may drive re-draft / commit). */
export const isContent = (o: BoundaryOutcome): o is { kind: "content" } => o.kind === "content";
/** True iff the outcome is the infrastructure recovery axis. */
export const isNoVerdict = (o: BoundaryOutcome): o is { kind: "no_verdict"; reason: NoVerdictReason } =>
  o.kind === "no_verdict";
