import { parseDecorations } from "@dusk/core-decoration";
import { buildDerivedIndex } from "@dusk/core-index";
import { describe, expect, it } from "vitest";

import { loadWorkedExample, workedExampleIntents, WORKED_EXAMPLE_FILE } from "./index.js";

// P5-T10 leg (a) — the App. B worked example's parse/index/inspect validation,
// run UNCONDITIONALLY on every PR (zero-model). The canonical decoration never
// silently rots: any structural regression in the fixture fails this suite.

describe("the worked example parses and indexes to its canonical structure", () => {
  const example = loadWorkedExample();

  it("every focal aspect of the five satisfied intents has a claimant", () => {
    for (const intent of [
      "notifications/send",
      "sync/pubsub-on-create",
      "observability/structured-logging",
      "error-handling/observable-failures",
      "api/idempotency-on-writes",
    ]) {
      expect(example.index.aspectRollup(intent), `${intent} lost a focal claimant`).toEqual([]);
    }
  });

  it("the canonical structural exceptions hold: the negative-polarity triple has no focal claim; the test child is unsatisfied", () => {
    // `no-raw-sql` is polarity-negative — the Verifier judges the ABSENCE of the
    // forbidden pattern; it never carries a focal claim in the clean decoration.
    expect(example.index.aspectRollup("db/use-drizzle-orm")).toEqual(["no-raw-sql"]);
    // The unit-tests child stays unsatisfied until test code exists (Phase-2 canonical).
    expect(example.index.aspectRollup("notifications/send/unit-tests")).toEqual(["covers-persist-first"]);
  });

  it("the implies intent and the negative-polarity triple are present in the fixture's intents", () => {
    const intents = workedExampleIntents();
    expect(intents.get("api/idempotency-on-writes")?.compose).toBe("implies");
    const noRawSql = intents.get("db/use-drizzle-orm")?.triples?.find((t) => t.id === "no-raw-sql");
    expect(noRawSql?.polarity).toBe("negative");
  });

  it("the defects variant is structurally distinct from the clean one", () => {
    const defects = loadWorkedExample({ variant: "defects" });
    expect(defects.source).not.toBe(example.source);
  });
});

describe("7.2 — a decoration regression in the fixture fails the suite naming the unsatisfied aspect", () => {
  it("removing the persist-first focal claim (test-scoped copy) surfaces persist-first in the rollup", () => {
    const broken = loadWorkedExample()
      .source.replace("normalize-target, persist-first,", "normalize-target,")
      .split("\n")
      .filter((line) => line.trim() !== "// @intent notifications/send [persist-first]")
      .join("\n");

    const records = parseDecorations(broken, WORKED_EXAMPLE_FILE);
    const index = buildDerivedIndex(records, workedExampleIntents());

    // The unsatisfied aspect is index-visible without a model — and named.
    expect(index.aspectRollup("notifications/send")).toEqual(["persist-first"]);
  });
});
