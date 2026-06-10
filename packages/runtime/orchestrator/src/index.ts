// @dusk/runtime-orchestrator — spawn pipeline + cross-phase runtime seam.
// Re-exports the pure contracts from @dusk/core-schema for ergonomic imports.
export type {
  Verdict,
  PerTripleVerdict,
  DuskError,
  DuskErrorKind,
  SubAgentTrace,
  SubAgentRole,
  InvocationSite,
  VerifierFactory,
  VerifierSpawnContext,
  VerifierResult,
  VerifierFixtureScript,
  ScriptedVerdictFactory,
  Result,
  RuntimeResult,
} from "@dusk/core-schema";
export { duskError, isDuskError, ok, err, isOk, isErr } from "@dusk/core-schema";

export * from "./env.js";
export * from "./redaction.js";
export * from "./roleFile.js";
export * from "./spawn.js";
