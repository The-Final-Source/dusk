// @intent-test-file api/metrics/unit-tests
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn().mockResolvedValue({ payload: { sub: "user123" }, protectedHeader: { alg: "RS256" } }),
}));
vi.mock("../lib/logger.js", () => ({ getLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })) }));
vi.mock("../jobs/index.js", () => ({ enqueueJob: vi.fn().mockResolvedValue("job-123") }));

import type { DogfoodReport, StaticAnalysisReport } from "@dusk/core-schema";

import { resolveArtifact, type ArtifactEnvelope } from "../services/metrics/artifactResolver.js";
import { createMetricsRouter } from "./metrics.js";

const ctx = { user: null, db: {} as never, pubsub: {} as never };

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

const VALID_STATIC: StaticAnalysisReport = {
  schema_version: 1,
  generated_at: "2026-06-14T00:00:00Z",
  mode: "conservative",
  findings: [],
  density_baseline: [],
};

// --- resolveArtifact unit tests ---

describe("resolveArtifact — absent sentinel", () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("returns { present: false } without throwing when the artifact file is absent", () => {
    tmp = mkdtempSync(join(tmpdir(), "dusk-metrics-"));
    const result = resolveArtifact("packages/api", "dogfood-report", tmp);
    expect(result).toEqual({ present: false });
  });
});

describe("resolveArtifact — path construction", () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("constructs the correct artifact file path from packageName and artifactType", () => {
    tmp = mkdtempSync(join(tmpdir(), "dusk-metrics-"));
    mkdirSync(join(tmp, "packages/api/.ia/artifacts"), { recursive: true });
    writeFileSync(join(tmp, "packages/api/.ia/artifacts/dogfood-report.json"), JSON.stringify(VALID_DOGFOOD), "utf8");
    const result = resolveArtifact("packages/api", "dogfood-report", tmp);
    expect(result.present).toBe(true);
    if (result.present) {
      expect((result.raw as DogfoodReport).schema_version).toBe(1);
    }
  });
});

describe("resolveArtifact — no disk writes", () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("does not write any file to disk when the artifact is absent", () => {
    tmp = mkdtempSync(join(tmpdir(), "dusk-metrics-"));
    resolveArtifact("packages/api", "dogfood-report", tmp);
    expect(readdirSync(tmp)).toHaveLength(0);
  });

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

describe("metricsRouter — expose-queries", () => {
  it("exposes dogfoodReport and staticAnalysisReport as callable query procedures", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: false }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    await expect(caller.dogfoodReport({ packageName: "packages/api" })).resolves.toBeDefined();
    await expect(caller.staticAnalysisReport({ packageName: "packages/api" })).resolves.toBeDefined();
  });
});

describe("metricsRouter — no mutations or subscriptions", () => {
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

describe("metricsRouter — presence envelope on absent artifact", () => {
  it("returns { present: false, data: null } for dogfoodReport when artifact is absent", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: false }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.dogfoodReport({ packageName: "packages/api" });
    expect(result).toEqual({ present: false, data: null });
  });

  it("returns { present: false, data: null } for staticAnalysisReport when artifact is absent", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: false }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.staticAnalysisReport({ packageName: "packages/api" });
    expect(result).toEqual({ present: false, data: null });
  });
});

describe("metricsRouter — presence envelope on valid artifact", () => {
  it("returns { present: true, data: <validated> } for dogfoodReport when artifact is present and valid", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: true, raw: VALID_DOGFOOD }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.dogfoodReport({ packageName: "packages/api" });
    expect(result).toEqual({ present: true, data: VALID_DOGFOOD });
  });

  it("returns { present: true, data: <validated> } for staticAnalysisReport when artifact is present and valid", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: true, raw: VALID_STATIC }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.staticAnalysisReport({ packageName: "packages/api" });
    expect(result).toEqual({ present: true, data: VALID_STATIC });
  });
});

describe("metricsRouter — schema validation and no-throw on failure", () => {
  it("validates dogfoodReport payload against DogfoodReportSchema before returning", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: true, raw: VALID_DOGFOOD }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.dogfoodReport({ packageName: "packages/api" });
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.data.schema_version).toBe(1);
    }
  });

  it("validates staticAnalysisReport payload against StaticAnalysisReportSchema before returning", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: true, raw: VALID_STATIC }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    const result = await caller.staticAnalysisReport({ packageName: "packages/api" });
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.data.schema_version).toBe(1);
    }
  });

  it("returns an error envelope instead of throwing for dogfoodReport on schema validation failure", async () => {
    const stub = vi.fn((): ArtifactEnvelope => ({ present: true, raw: { invalid: "payload" } }));
    const caller = createMetricsRouter(stub).createCaller(ctx);
    await expect(caller.dogfoodReport({ packageName: "packages/api" })).resolves.toMatchObject({
      present: false,
      data: null,
      parseError: expect.any(String),
    });
  });

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
