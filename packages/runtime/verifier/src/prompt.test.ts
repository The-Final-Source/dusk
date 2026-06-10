import { loadWorkedExample } from "@dusk/fixtures";
import { type Triple } from "@dusk/core-schema";
import { describe, expect, test } from "vitest";

import { buildAffirmativeQuestion, buildVerifierUserPrompt, type TripleToJudge } from "./prompt.js";

// Task 5.4 / P2-T5 (raw_prompt half) + P2-T17 — affirmative prompt builder.

const triple = (p: Partial<Triple>): Triple => ({
  id: "t",
  subject: "the service layer",
  predicate: "constructs queries via",
  object: "raw SQL string templates",
  polarity: "positive",
  ...p,
});

describe("buildAffirmativeQuestion", () => {
  test("never poses a negated question, even for negative polarity", () => {
    const q = buildAffirmativeQuestion(triple({ polarity: "negative" }));
    expect(q).not.toMatch(/does NOT|does not|is not|must not|never /);
    expect(q).toContain("constructs queries via raw SQL string templates");
  });

  test("annotates the quantifier bound within the named scope", () => {
    const q = buildAffirmativeQuestion(
      triple({ predicate: "emits a SyncEvent on the notification channel", object: "for each inserted notification", quantifier: "exactly-one", scope: "per inserted notification row" }),
    );
    expect(q).toContain("exactly once per inserted notification row");
  });

  test("the ≤-direction and none quantifiers stay count-positive (no negation)", () => {
    for (const quantifier of ["none", "at-most-one", "at-most-2"]) {
      const q = buildAffirmativeQuestion(triple({ quantifier }));
      expect(q).not.toMatch(/\bnever\b|does not|is not/);
    }
  });
});

describe("buildVerifierUserPrompt — compose: implies presents consequents only (P2-T17)", () => {
  test("consequent triples appear; antecedent triples do not", () => {
    const wx = loadWorkedExample();
    const intent = wx.intents.get("api/idempotency-on-writes")!;
    const toJudge: TripleToJudge[] = (intent.consequent ?? []).map((t) => ({ triple: t, focal: [], support: [] }));
    const prompt = buildVerifierUserPrompt(intent, toJudge);

    expect(prompt).toContain("validates-idempotency");
    expect(prompt).toContain("stores-idempotency");
    // the antecedent triple + its closed predicate must be absent from the triples-to-judge
    expect(prompt).not.toContain("is-write");
    expect(prompt).not.toContain("is decorated with");
  });
});
