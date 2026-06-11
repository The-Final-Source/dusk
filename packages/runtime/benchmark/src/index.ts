// @dusk/runtime-benchmark — the per-role per-model harness (design D6), the
// three-axis fresh-Verifier audit (design D1/D2; NO LLM-judge), the seeded
// fixture manifest + drift guard (design D7), and the dogfood evaluation
// (design D8).
export {
  buildSeededManifest,
  writeSeededManifest,
  seededViolationsRoot,
  GroundTruthOutcomeSchema,
  SeededFixtureSchema,
  GROUND_TRUTH_OUTCOMES,
  type GroundTruthOutcome,
  type SeededFixture,
  type SeededFixtureMeta,
  type SeededManifest,
} from "./fixtureManifest.js";
export { materializeFixtureProject } from "./fixtureProject.js";
export { scoreCitationPrecision, extractCitations, type CitationEvidence, type CitationScore, type GroundTruthDefectLoc } from "./citationPrecision.js";
export { shannonEntropy, tokenOverlap, meanPairwiseOverlap, fixtureAuditResult, scoreAxes, quadrantFlag, type AuditCall } from "./auditAxes.js";
export { enforcePreRegistration, defaultThresholdsPath, AUDIT_REFUSALS, type AuditRefusal } from "./auditProtocol.js";
export { runFreshnessAudit, knownBadFixtures, type AuditVariant, type FixtureVerifierCall, type RunAuditOptions, type Clock } from "./auditRunner.js";
export { calibrateAudit, type CalibrateOptions } from "./calibrate.js";
export { assembleOrganicCohort } from "./organicCohort.js";
export { realFixtureVerifierCall } from "./realAuditCall.js";
export { realGateLeg, realStaticAnalyzerLeg, gateBlocksAnyFile } from "./realLegs.js";
export { realTestPrepassVerdict, realTestPrepassFactory, TEST_PREPASS_SYSTEM_PROMPT, type TestPrepassDeps } from "./testPrepass.js";
export { withTransportRetry, TransportLegFailure } from "./transportRetry.js";
export { runBenchmarkSweep, readSweepRecords, verdictsPath, SweepRecordSchema, type SweepRecord, type SweepModel, type SweepDeps } from "./sweep.js";
export { assembleBenchmarkReport, perClassAccuracy, perRoleLatencyCost, agreementMatrix } from "./reportPostPass.js";
export { characterizeFlakeRate, type FlakeOptions } from "./flake.js";
export {
  appendDogfoodEvent,
  readDogfoodEvents,
  evaluateDogfood,
  dogfoodDir,
  DogfoodEventSchema,
  type DogfoodEvent,
} from "./dogfood.js";
