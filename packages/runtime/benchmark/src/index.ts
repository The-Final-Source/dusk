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
// Phase-6 audit tooling (greenfield POC) — §5.1–5.3 primitives + the §6 PocReport
// evaluator. Zero-model pure passes.
export {
  classifyApplicationSource,
  isTrailerRequired,
  PYRAMID_SUFFIXES,
  type SourceClass,
  type ClassifySourceResult,
} from "./applicationSource.js";
export {
  parseGitLog,
  auditTrailers,
  hasFullTrailers,
  GIT_LOG_FORMAT,
  REQUIRED_TRAILER_KEYS,
  CONDITIONAL_TRAILER_KEYS,
  HUMAN_INPUT_WHITELIST,
  type ParsedCommit,
  type HumanAction,
  type HumanInputKind,
  type TrailerViolation,
  type TrailerAuditResult,
  type AuditInput,
} from "./trailerAudit.js";
export {
  checkProvenance,
  readAuthorTraceIds,
  readFinalizeCreatedIds,
  type ProvenanceViolation,
  type ProvenanceResult,
  type CheckProvenanceInput,
} from "./provenanceCheck.js";
export { evaluatePoc, type PocEvaluatorInput, type PocEvaluation } from "./pocEvaluator.js";
