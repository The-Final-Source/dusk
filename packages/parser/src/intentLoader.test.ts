import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadIntentDirectory } from "./intentLoader.js";

describe("loadIntentDirectory", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dusk-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads complete directory with all files", async () => {
    await writeFile(
      join(tempDir, "intent.yaml"),
      `
id: test-intent
scope: packages/test
adopts:
  - some-block
`,
    );
    await writeFile(
      join(tempDir, "source-map.json"),
      JSON.stringify({
        intent: "test-intent",
        intent_hash:
          "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        synced_at: "2025-01-15T10:30:00Z",
        stale: false,
        mappings: [],
      }),
    );
    await writeFile(
      join(tempDir, "audit.json"),
      JSON.stringify({
        intent: "test-intent",
        composed_at: "2025-01-15T10:00:00Z",
        composition_version: "1.0.0",
        decisions: [],
      }),
    );

    const result = await loadIntentDirectory(tempDir);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent.id).toBe("test-intent");
      expect(result.data.sourceMap).not.toBeNull();
      expect(result.data.audit).not.toBeNull();
    }
  });

  it("handles missing optional files gracefully", async () => {
    await writeFile(
      join(tempDir, "intent.yaml"),
      `
id: test-intent
scope: packages/test
adopts: []
`,
    );

    const result = await loadIntentDirectory(tempDir);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceMap).toBeNull();
      expect(result.data.audit).toBeNull();
    }
  });

  it("returns error when intent.yaml is missing", async () => {
    const result = await loadIntentDirectory(tempDir);
    expect(result.success).toBe(false);
  });

  it("returns error when intent.yaml is invalid", async () => {
    await writeFile(
      join(tempDir, "intent.yaml"),
      "not: valid: yaml: content: [",
    );
    const result = await loadIntentDirectory(tempDir);
    expect(result.success).toBe(false);
  });
});
