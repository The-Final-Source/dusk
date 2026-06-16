import { describe, expect, test } from "vitest";

import { SidecarBodySchema } from "./decorationSidecar.js";

// universal-decoration-coverage §2.2 — the sidecar body schema (Zod = SoT).

describe("SidecarBodySchema", () => {
  test("parses a canonical whole-file sidecar", () => {
    const parsed = SidecarBodySchema.parse({
      schema_version: 1,
      target: "package.json",
      claims: [{ anchor: "", marker: "intent-file", intent_path: "pkg/manifest" }],
    });
    expect(parsed.claims[0].marker).toBe("intent-file");
    expect(parsed.ignore).toEqual([]); // defaulted
  });

  test("parses per-key claims with aspects and ignore entries", () => {
    const parsed = SidecarBodySchema.parse({
      schema_version: 1,
      target: "tsconfig.json",
      claims: [{ anchor: "/compilerOptions", marker: "intent", intent_path: "build/tsconfig", aspect_ids: ["strict"] }],
      ignore: [{ anchor: "/references", because: ["this-file", "is-generated-by", "turbo"], reason: "managed by turbo" }],
    });
    expect(parsed.claims[0].aspect_ids).toEqual(["strict"]);
    expect(parsed.ignore[0].because).toHaveLength(3);
  });

  test("rejects an unknown schema_version", () => {
    expect(SidecarBodySchema.safeParse({ schema_version: 2, target: "x", claims: [] }).success).toBe(false);
  });

  test("rejects an unknown marker and a missing target", () => {
    expect(SidecarBodySchema.safeParse({ schema_version: 1, target: "x", claims: [{ anchor: "", marker: "bogus", intent_path: "a/b" }] }).success).toBe(false);
    expect(SidecarBodySchema.safeParse({ schema_version: 1, claims: [] }).success).toBe(false);
  });

  test("rejects unknown keys (strict)", () => {
    expect(SidecarBodySchema.safeParse({ schema_version: 1, target: "x", claims: [], extra: true }).success).toBe(false);
  });
});
