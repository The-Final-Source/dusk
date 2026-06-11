import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, vi, afterEach } from "vitest";

// Mock the unmanaged app dependencies exactly like the pre-existing router tests
// (the registry procedures themselves never touch the db).
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

import { appRouter } from "./index.js";
import { getAdherenceSummary } from "../services/registry/index.js";

// P5-T14 (api half) — the registry router ships three routable Zod-validated
// procedures; existing routes untouched. Zero-model; the registry reads the
// real canonical intent library + the derived index (no adherence DB).

const caller = appRouter.createCaller({ user: null, db: {} as never, pubsub: {} as never });

describe("registry.searchCanonicalIntents", () => {
  it("substring-searches the canonical library by name/description", async () => {
    const all = await caller.registry.searchCanonicalIntents({ query: "" });
    expect(all.intents.length).toBeGreaterThanOrEqual(13);
    const pagination = await caller.registry.searchCanonicalIntents({ query: "pagination" });
    expect(pagination.intents.length).toBeGreaterThan(0);
    expect(pagination.intents.every((i) => /pagination/i.test(i.path) || /pagination/i.test(i.description))).toBe(true);
    for (const entry of all.intents) {
      expect(entry).toMatchObject({ path: expect.any(String), description: expect.any(String), obligation: expect.any(String) });
    }
  });
});

describe("registry.getCanonicalIntent", () => {
  it("returns one canonical intent's parsed content by path", async () => {
    const { intent } = await caller.registry.getCanonicalIntent({ path: "api/auth-required" });
    expect(intent.id).toBe("api/auth-required");
    expect(intent.obligation).toBe("must");
    expect(intent.triples?.length).toBeGreaterThan(0);
  });

  it("NOT_FOUND for an unknown path", async () => {
    await expect(caller.registry.getCanonicalIntent({ path: "no/such/intent" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("registry.getAdherenceSummary", () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("computes hierarchical satisfaction on demand from the derived index (no adherence DB)", () => {
    tmp = mkdtempSync(join(tmpdir(), "dusk-registry-"));
    mkdirSync(join(tmp, ".ia/intents/demo/alpha"), { recursive: true });
    writeFileSync(
      join(tmp, ".ia/intents/demo/alpha/intent.yaml"),
      "schema_version: 2\nid: demo/alpha\ndescription: alpha\nobligation: must\ncompose: all\ntriples:\n  - id: a1\n    subject: s\n    predicate: p\n    object: o\n  - id: a2\n    subject: s\n    predicate: p\n    object: o\n",
      "utf8",
    );
    mkdirSync(join(tmp, "packages/demo/src"), { recursive: true });
    writeFileSync(
      join(tmp, "packages/demo/src/feature.ts"),
      `// @intent demo/alpha [a1]
export function doAlpha(): string {
  // @intent demo/alpha [a1]
  return "alpha";
}

function helper(): string {
  return "h";
}
`,
      "utf8",
    );

    const summary = getAdherenceSummary("packages/demo", { repoRoot: tmp });
    expect(summary.package).toBe("packages/demo");
    const alpha = summary.intents.find((i) => i.path === "demo/alpha")!;
    expect(alpha).toMatchObject({ total_aspects: 2, unsatisfied_aspects: ["a2"], satisfied: false, claimed_in_package: true });
    expect(summary.coverage).toEqual([{ file: "packages/demo/src/feature.ts", decorated_units: 1, undecorated_units: 1 }]);
  });

  it("responds with a schema-valid non-error summary through the router", async () => {
    const summary = await caller.registry.getAdherenceSummary({ package: "packages/fixtures/worked-example" });
    expect(summary.package).toBe("packages/fixtures/worked-example");
    expect(Array.isArray(summary.intents)).toBe(true);
    expect(summary.coverage.length).toBeGreaterThan(0);
  });
});
