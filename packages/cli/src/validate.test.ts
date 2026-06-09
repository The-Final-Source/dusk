import { describe, test, expect } from "vitest";

import { createTempRepo } from "@dusk/test-harness";

import { validateIntents } from "./validate.js";

describe("dusk validate (P1-T19)", () => {
  test("reports malformed intents with file:line and passes once fixed", () => {
    const repo = createTempRepo({ git: false });
    repo.write("dusk.config.yml", "version: 1\n");
    // missing `obligation`; triple missing `predicate`
    repo.write(".ia/intents/api/x/intent.yaml", "id: api/x\ndescription: d\ntriples:\n  - id: t\n    subject: s\n    object: o\n");

    const bad = validateIntents(repo.dir);
    expect(bad.ok).toBe(false);
    expect(bad.failures.every((f) => f.file.endsWith("intent.yaml") && f.line >= 1)).toBe(true);
    expect(bad.failures.some((f) => f.message.toLowerCase().includes("obligation"))).toBe(true);

    repo.write(".ia/intents/api/x/intent.yaml", "id: api/x\ndescription: d\nobligation: must\ntriples:\n  - id: t\n    subject: s\n    predicate: p\n    object: o\n");
    expect(validateIntents(repo.dir).ok).toBe(true);
    repo.cleanup();
  });
});
