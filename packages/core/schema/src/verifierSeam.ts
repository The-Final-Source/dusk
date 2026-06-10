import type { DuskError } from "./duskError.js";
import type { Verdict } from "./verdict.js";

/**
 * The Verifier-double pluggability seam (design D5). A `VerifierFactory` is what
 * the spawn pipeline invokes for `role: "verifier"` spawns — the real factory
 * runs the §3.3 procedure; the scripted-verdict double returns pre-baked verdicts.
 * Both produce the same `SubAgentTrace` shape. Pinned in the leaf so the
 * test-harness, orchestrator, verifier, and verifier-test-double all bind to one
 * definition without a package cycle.
 */
export type VerifierSpawnContext = {
  /** The intent under evaluation (drives fixture selection in the double). */
  intentPath: string;
  /** The specific aspect/triple under evaluation, when scoped. */
  aspectId?: string;
  beadId?: string;
  sessionId: string;
  iterationNumber?: number;
  /** The verbatim assembled prompt (the double ignores it; the real factory may not need it). */
  assembledPrompt: string;
  /** Opaque per-call verifier input; the real factory casts it to its typed input. */
  input?: unknown;
};

export type VerifierResult = Verdict | DuskError;

export type VerifierFactory = (ctx: VerifierSpawnContext) => Promise<VerifierResult>;

/**
 * A scripted fixture: either an ordered list of verdicts consumed one per spawn,
 * or a selector that routes a verdict by spawn context. Exhaustion is honest
 * (the double returns a structural error, never a fabricated verdict).
 */
export type VerifierFixtureScript = Verdict[] | ((ctx: VerifierSpawnContext) => Verdict | undefined);

/** The shim signature the `verifier-test-double` package implements (task 1.3 / 4.1). */
export type ScriptedVerdictFactory = (script: VerifierFixtureScript) => VerifierFactory;
