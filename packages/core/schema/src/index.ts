// @dusk/core-schema — the universal leaf for cross-cutting CONTRACTS: Zod
// schemas (the type source of truth) AND canonical `.ia` path construction
// (iaPaths — pure, no I/O). It is the only package every other package, INCLUDING
// `packages/api`, can depend on without coupling to the runtime layers. Add here
// only contracts that must be reachable that broadly; keep everything pure.
export * from "./primitives.js";
export * from "./intent.js";
export * from "./migration.js";
export * from "./load.js";
export * from "./config.js";
export * from "./decorationSidecar.js";
export * from "./verdict.js";
export * from "./duskError.js";
export * from "./result.js";
export * from "./subAgentTrace.js";
export * from "./verifierSeam.js";
export * from "./spawnSeam.js";
export * from "./implementCheckpoint.js";
export * from "./cancelResult.js";
export * from "./testVerdict.js";
export * from "./livelockReport.js";
export * from "./commitTrailers.js";
export * from "./ids.js";
export * from "./beadDag.js";
export * from "./dialogState.js";
export * from "./authorSeam.js";
export * from "./intentProposal.js";
export * from "./auditThresholds.js";
export * from "./auditReport.js";
export * from "./benchmarkReport.js";
export * from "./dogfoodReport.js";
export * from "./pocReport.js";
export * from "./staticAnalysisReport.js";
export * from "./iaPaths.js";
