// @intent-test-file api/metrics/unit-tests
// @intent-support api/metrics/unit-tests [covers-absent-sentinel, covers-construct-path, covers-no-disk-writes] ["the unit test" "imports" "file-system helpers for creating temp dirs and writing test fixtures"]
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
// @intent-support api/metrics/unit-tests [covers-absent-sentinel, covers-construct-path, covers-no-disk-writes] ["the unit test" "imports" "the OS temp-directory locator for isolated artifact path tests"]
import { tmpdir } from "node:os";
// @intent-support api/metrics/unit-tests [covers-absent-sentinel, covers-construct-path, covers-no-disk-writes] ["the unit test" "imports" "the path join utility for constructing temp artifact paths"]
import { join } from "node:path";

// @intent-support api/metrics/unit-tests [covers-absent-sentinel, covers-construct-path, covers-no-disk-writes, covers-expose-queries, covers-no-mutations, covers-presence-envelope, covers-validate-schema, covers-no-throw-on-failure] ["the unit test" "imports" "the vitest test runner utilities used across all test suites"]
import { afterEach, describe, expect, it, vi } from "vitest";

// @intent-support api/metrics/unit-tests [covers-expose-queries, covers-no-mutations, covers-presence-envelope, covers-validate-schema, covers-no-throw-on-failure] ["the unit test" "mocks" "the database module to isolate router tests from unmanaged infrastructure"]
vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));
// @intent-support api/metrics/unit-tests [covers-expose-queries, covers-no-mutations, covers-presence-envelope, covers-validate-schema, covers-no-throw-on-failure] ["the unit test" "mocks" "the jose JWKS module to isolate router tests from auth infrastructure"]
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn().mockResolvedValue({ payload: { sub: "user123" }, protectedHeader: { alg: "RS256" } }),
}));
// @intent-support api/metrics/unit-tests [covers-expose-queries, covers-no-mutations, covers-presence-envelope, covers-validate-schema, covers-no-throw-on-failure] ["the unit test" "mocks" "the logger module to suppress real log output during router tests"]
vi.mock("../lib/logger.js", () => ({ getLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })) }));
// @intent-support api/metrics/unit-tests [covers-expose-queries, covers-no-mutations, covers-presence-envelope, covers-validate-schema, covers-no-throw-on-failure] ["the unit test" "mocks" "the jobs module to isolate router tests from the job queue"]
vi.mock("../jobs/index.js", () => ({ enqueueJob: vi.fn().mockResolvedValue("job-123") }));

// @intent-support api/metrics/unit-tests [covers-presence-envelope, covers-validate-schema, covers-no-throw-on-failure] ["the unit test" "imports" "the Dusk report type definitions for constructing valid and invalid fixture payloads"]
import type { DogfoodReport, StaticAnalysisReport } from "@dusk/core-schema";

// @intent-support api/metrics/unit-tests [covers-absent-sentinel, covers-construct-path, covers-no-disk-writes] ["the unit test" "imports" "the artifact resolver and envelope type as the primary subject under test"]
import { resolveArtifact, type ArtifactEnvelope } from "../services/metrics/artifactResolver.js";
// @intent-support api/metrics/unit-tests [covers-expose-queries, covers-no-mutations, covers-presence-envelope, covers-validate-schema, covers-no-throw-on-failure] ["the unit test" "imports" "the metrics router factory with injected stub resolver for mock-first router tests"]
import { createMetricsRouter } from "./metrics.js";

// @intent-support api/metrics/unit-tests [covers-expose-queries, covers-no-mutations, covers-presence-envelope, covers-validate-schema, covers-no-throw-on-failure] ["the unit test" "declares" "a minimal tRPC caller context shared across all router test suites"]
const ctx = { user: null, db: {} as never, pubsub: {} as never };

// @intent-support api/metrics/unit-tests [covers-presence-envelope, covers-validate-schema, covers-no-throw-on-failure] ["the unit test" "declares" "a schema-valid dogfood report fixture for presence-envelope and schema-validation test paths"]
const VALID_DOGFOOD: DogfoodReport = {
  schema_version: 1,
  package: "packages/api",
  window: { first_decorated_commit_at: "2026-06-14T00:00:00Z", evaluated_at: "2026-06-14T00:00:00Z", days: 7 },
  gating: {
    e2e_implement_success_count: { value: 1, threshold: ">= 1", pass: true },
    gate_false_positive_count: { value: 0, threshold: "== 0", pass: true },
    worked_example_regression: { value: "clean", threshold: "clean", pass: true },
    package_test_suite: { value: "green", threshold: "green", pass: true },
    pass: true,
  },
  exploratory: {
    gating: false,
    iteration_distribution: {},
    author_branching_distribution: {},
    stuckness_fire_count: 0,
    livelock_count: 0,
    doctor_finding_trend: [],
    api_expansion: { begun: false, notes: "" },
    friction_observations: [],
    friction_commits: [],
  },
};

// @intent-support api/metrics/unit-tests [covers-presence-envelope, covers-validate-schema, covers-no-throw-on-failure] ["the unit test" "declares" "a schema-valid static-analysis report fixture for presence-envelope and schema-validation test paths"]
const VALID_STATIC: StaticAnalysisReport = {
  schema_version: 1,
  generated_at: "2026-06-14T00:00:00Z",
  mode: "conservative",
  findings: [],
  density_baseline: [],
};

// --- resolveArtifact unit tests ---

// @intent-support api/metrics/unit-tests [covers-absent-sentinel] ["the unit test" "verifies" "that the artifact resolver returns { present: false } without throwing when the artifact file is absent"]
describe("resolveArtifact — absent sentinel", () => {
  // @intent-support api/metrics/unit-tests [covers-absent-sentinel] ["the unit test" "declares" "a mutable temp-dir handle scoped to the absent-sentinel suite"]
  let tmp: string | undefined;
  // @intent-support api/metrics/unit-tests [covers-absent-sentinel] ["the unit test" "tears down" "the temp directory after each absent-sentinel test to prevent cross-test contamination"]
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  // @intent-support api/metrics/unit-tests [covers-absent-sentinel] ["the unit test" "asserts" "that resolveArtifact returns { present: false } without throwing when the artifact file is absent"]
  it("returns { present: false } without throwing when the artifact file is absent", () => {
    tmp = mkdtempSync(join(tmpdir(), "dusk-metrics-"));
    const result = resolveArtifact("packages/api", "dogfood-report", tmp);
    expect(result).toEqual({ present: false });
  });
});

// @intent-support api/metrics/unit-tests [covers-construct-path] ["the unit test" "verifies" "that the artifact resolver constructs the correct file path from a package name and artifact type"]
describe("resolveArtifact — path construction", () => {
  // @intent-support api/metrics/unit-tests [covers-construct-path] ["the unit test" "declares" "a mutable temp-dir handle scoped to the path-construction suite"]
  let tmp: string | undefined;
  // @intent-support api/metrics/unit-tests [covers-construct-path] ["the unit test" "tears down" "the temp directory after each path-construction test"]
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  // @intent-support api/metrics/unit-tests [covers-construct-path] ["the unit test" "asserts" "that the artifact file is found when the path is constructed from packageName and artifactType"]
  it("constructs the correct artifact file path from packageName and artifactType", () => {
    tmp = mkdtempSync(join(tmpdir(), "dusk-metrics-"));
    // Real artifact location (operator wiring fix): .ia/observability/dogfood/.
    mkdirSync(join(tmp, "packages/api/.ia/observability/dogfood"), { recursive: true });
    writeFileSync(join(tmp, "packages/api/.ia/observability/dogfood/dogfood-report.json"), JSON.stringify(VALID_DOGFOOD), "utf8");
    const result = resolveArtifact("packages/api", "dogfood-report", tmp);
    expect(result.present).toBe(true);
    if (result.present) {
      expect((result.raw as DogfoodReport).schema_version).toBe(1);
    }
  });
});

// @intent-support api/metrics/unit-tests [covers-no-disk-writes] ["the unit test" "verifies" "that the artifact resolver does not write any file to disk"]
describe("resolveArtifact — no disk writes", () => {
  // @intent-support api/metrics/unit-tests [covers-no-disk-writes] ["the unit test" "declares" "a mutable temp-dir handle scoped to the no-disk-writes suite"]
  let tmp: string | undefined;
  // @intent-support api/metrics/unit-tests [covers-no-disk-writes] ["the unit test" "tears down" "the temp directory after each disk-write-check test"]
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  // @intent-support api/metrics/unit-tests [covers-no-disk-writes] ["the unit test" "asserts" "that the artifact resolver leaves the temp directory empty when the artifact is absent"]
  it("does not write any file to disk when the artifact is absent", () => {
    tmp = mkdtempSync(join(tmpdir(), "dusk-metrics-"));
    resolveArtifact("packages/api", "dogfood-report", tmp);
    expect(readdirSync(tmp)).toHaveLength(0);
  });

  // @intent-support api/metrics/unit-tests [covers-no-disk-writes] ["the unit test" "asserts" "that the artifact resolver leaves the artifact directory unchanged when reading a present artifact"]
  it("does not write any file to disk when the artifact is present", () => {
    tmp = mkdtempSync(join(tmpdir(), "dusk-metrics-"));
    mkdirSync(join(tmp, "packages/api/.ia/artifacts"), { recursive: true });
    writeFileSync(join(tmp, "packages/api/.ia/artifacts/dogfood-report.json"), JSON.stringify(VALID_DOGFOOD), "utf8");
    const before = readdirSync(join(tmp, "packages/api/.ia/artifacts")).length;
    resolveArtifact("packages/api", "dogfood-report", tmp);
    expect(readdirSync(join(tmp, "packages/api/.ia/artifacts"))).toHaveLength(before);
  });
});

// --- metricsRouter unit tests (stub resolver, no real file I/O) ---

// @intent-support api/metrics/unit-tests [covers-expose-queries] ["the unit test" "verifies" "that the metrics router exposes query procedures for the dogfood and static-analysis report artifacts"]
describe("metricsRouter — expose-queries", () => {
  // @intent-support api/metrics/unit-tests [covers-expose-queries] ["the unit test" "asserts" "that dogfoodReport and staticAnalysisReport are callable query procedures on the metrics router"]
  it("exposes dogfoodReport and staticAnalysisReport as callable query procedures", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: false }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    await expect(caller.dogfoodReport({ packageName: "packages/api" })).resolves.toBeDefined();
    await expect(caller.staticAnalysisReport({ packageName: "packages/api" })).resolves.toBeDefined();
  });
});

// @intent-support api/metrics/unit-tests [covers-no-mutations] ["the unit test" "verifies" "that the metrics router does not expose mutations or subscriptions"]
describe("metricsRouter — no mutations or subscriptions", () => {
  // @intent-support api/metrics/unit-tests [covers-no-mutations] ["the unit test" "asserts" "that every procedure on the metrics router has type query and no mutations or subscriptions exist"]
  it("does not expose mutation or subscription procedures", () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: false }));
    const r = createMetricsRouter(stub);
    const procedures = Object.values(r._def.procedures);
    expect(procedures.length).toBeGreaterThan(0);
    for (const proc of procedures) {
      expect((proc as { _def: { type: string } })._def.type).toBe("query");
    }
  });
});

// @intent-support api/metrics/unit-tests [covers-presence-envelope] ["the unit test" "verifies" "that each procedure returns { present: false, data: null } when the artifact is absent"]
describe("metricsRouter — presence envelope on absent artifact", () => {
  // @intent-support api/metrics/unit-tests [covers-presence-envelope] ["the unit test" "asserts" "that dogfoodReport returns { present: false, data: null } when the stub resolver signals absence"]
  it("returns { present: false, data: null } for dogfoodReport when artifact is absent", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: false }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.dogfoodReport({ packageName: "packages/api" });
    expect(result).toEqual({ present: false, data: null });
  });

  // @intent-support api/metrics/unit-tests [covers-presence-envelope] ["the unit test" "asserts" "that staticAnalysisReport returns { present: false, data: null } when the stub resolver signals absence"]
  it("returns { present: false, data: null } for staticAnalysisReport when artifact is absent", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: false }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.staticAnalysisReport({ packageName: "packages/api" });
    expect(result).toEqual({ present: false, data: null });
  });
});

// @intent-support api/metrics/unit-tests [covers-presence-envelope] ["the unit test" "verifies" "that each procedure returns { present: true, data: <validated payload> } when the artifact is present and valid"]
describe("metricsRouter — presence envelope on valid artifact", () => {
  // @intent-support api/metrics/unit-tests [covers-presence-envelope] ["the unit test" "asserts" "that dogfoodReport returns { present: true, data: <validated> } when the stub resolver returns a valid dogfood payload"]
  it("returns { present: true, data: <validated> } for dogfoodReport when artifact is present and valid", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: true, raw: VALID_DOGFOOD }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.dogfoodReport({ packageName: "packages/api" });
    expect(result).toEqual({ present: true, data: VALID_DOGFOOD });
  });

  // @intent-support api/metrics/unit-tests [covers-presence-envelope] ["the unit test" "asserts" "that staticAnalysisReport returns { present: true, data: <validated> } when the stub resolver returns a valid static-analysis payload"]
  it("returns { present: true, data: <validated> } for staticAnalysisReport when artifact is present and valid", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: true, raw: VALID_STATIC }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.staticAnalysisReport({ packageName: "packages/api" });
    expect(result).toEqual({ present: true, data: VALID_STATIC });
  });
});

// @intent-support api/metrics/unit-tests [covers-validate-schema, covers-no-throw-on-failure] ["the unit test" "verifies" "that each report procedure validates the raw payload against its Zod schema and returns an error envelope instead of throwing on failure"]
describe("metricsRouter — schema validation and no-throw on failure", () => {
  // @intent-support api/metrics/unit-tests [covers-validate-schema] ["the unit test" "asserts" "that dogfoodReport validates the payload against DogfoodReportSchema and returns the typed data on success"]
  it("validates dogfoodReport payload against DogfoodReportSchema before returning", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: true, raw: VALID_DOGFOOD }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.dogfoodReport({ packageName: "packages/api" });
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.data.schema_version).toBe(1);
    }
  });

  // @intent-support api/metrics/unit-tests [covers-validate-schema] ["the unit test" "asserts" "that staticAnalysisReport validates the payload against StaticAnalysisReportSchema and returns the typed data on success"]
  it("validates staticAnalysisReport payload against StaticAnalysisReportSchema before returning", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: true, raw: VALID_STATIC }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.staticAnalysisReport({ packageName: "packages/api" });
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.data.schema_version).toBe(1);
    }
  });

  // @intent-support api/metrics/unit-tests [covers-no-throw-on-failure] ["the unit test" "asserts" "that dogfoodReport returns an error envelope with parseError instead of throwing when schema validation fails"]
  it("returns an error envelope instead of throwing for dogfoodReport on schema validation failure", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: true, raw: { invalid: "payload" } }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    await expect(caller.dogfoodReport({ packageName: "packages/api" })).resolves.toMatchObject({
      present: false,
      data: null,
      parseError: expect.any(String),
    });
  });

  // @intent-support api/metrics/unit-tests [covers-no-throw-on-failure] ["the unit test" "asserts" "that staticAnalysisReport returns an error envelope with parseError instead of throwing when schema validation fails"]
  it("returns an error envelope instead of throwing for staticAnalysisReport on schema validation failure", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: true, raw: { invalid: "payload" } }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    await expect(caller.staticAnalysisReport({ packageName: "packages/api" })).resolves.toMatchObject({
      present: false,
      data: null,
      parseError: expect.any(String),
    });
  });
});
