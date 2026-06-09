import { describe, test, expect } from "vitest";

import { findIllegalNegation, type Slot } from "./negationDetector.js";

// P1-T3 (unit-only): a pure transform with no I/O. The corpus encodes the
// matrix-vs-constituent boundary: the full lexicon is rejected in the predicate
// slot; constituent negation inside subject/object noun phrases is legal.
const CORPUS: Array<[Slot, string, boolean]> = [
  // predicate — matrix-negation lexicon → rejected
  ["predicate", "does not return", true],
  ["predicate", "do not emit", true],
  ["predicate", "did not persist", true],
  ["predicate", "is not", true],
  ["predicate", "cannot parse", true],
  ["predicate", "must not write", true],
  ["predicate", "never returns", true],
  ["predicate", "fails to validate", true],
  ["predicate", "refrains from logging", true],
  ["predicate", "lacks", true],
  ["predicate", "lacking", true],
  ["predicate", "omits", true],
  ["predicate", "excludes", true],
  ["predicate", "forbids", true],
  ["predicate", "prohibits", true],
  ["predicate", "prevents", true],
  ["predicate", "disallows", true],
  ["predicate", "denies", true],
  ["predicate", "rejects", true],
  ["predicate", "refuses", true],
  ["predicate", "bars", true],
  ["predicate", "is devoid of side effects", true],
  ["predicate", "is free of network access", true],
  ["predicate", "is free from logging", true],
  ["predicate", "is missing", true],
  ["predicate", "is absent", true],
  ["predicate", "doesn't return", true],
  // predicate — affirmative → allowed
  ["predicate", "return", false],
  ["predicate", "accept", false],
  ["predicate", "validate", false],
  ["predicate", "use", false],
  ["predicate", "constructs", false],
  ["predicate", "runs in", false],
  ["predicate", "include", false],
  // 'not' must not false-trigger on substrings like 'another'/'notification'
  ["predicate", "notifies the channel", false],
  ["predicate", "delivers to another queue", false],
  // subject / object — constituent negation inside a noun phrase is legal
  ["subject", "a function with no required arguments", false],
  ["object", "a sandboxed environment free of network access", false],
  ["object", "a type with no discriminator", false],
  ["subject", "the list with missing entries", false],
  ["object", "a request that does not include a cursor", false],
];

describe("findIllegalNegation (P1-T3)", () => {
  test.each(CORPUS)("%s slot: %j -> rejected=%s", (slot, value, rejected) => {
    expect(findIllegalNegation(slot, value) !== null).toBe(rejected);
  });
});
