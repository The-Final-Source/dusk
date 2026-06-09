import { describe, test, expect } from "vitest";

import { createTempRepo } from "@dusk/test-harness";

import { inspectIntent } from "./inspect.js";

describe("dusk inspect", () => {
  test("shows test-pyramid children and flags the unsatisfied one (no test code yet)", () => {
    const repo = createTempRepo({ git: false });
    repo.write("dusk.config.yml", "version: 1\n");
    const mk = (id: string, triple: string) =>
      repo.write(`.ia/intents/${id}/intent.yaml`, `id: ${id}\ndescription: d\nobligation: must\ntriples:\n  - id: ${triple}\n    subject: s\n    predicate: p\n    object: o\n`);
    mk("notifications/send", "persist");
    mk("notifications/send/unit-tests", "covers");

    const result = inspectIntent(repo.dir, "notifications/send");
    expect(result).not.toBeNull();
    expect(result?.testChildren).toContain("notifications/send/unit-tests");
    expect(result?.unsatisfiedTestChildren).toContain("notifications/send/unit-tests");
    repo.cleanup();
  });
});
