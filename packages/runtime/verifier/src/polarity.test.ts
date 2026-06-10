import { describe, expect, test } from "vitest";

import { focalVerdictFromAffirmative } from "./polarity.js";

// Task 5.5 (pure logic half) — runtime polarity inversion truth table.
// The 2×2 against the real model is the gated test in procedure.real.test.ts.

describe("focalVerdictFromAffirmative", () => {
  test("positive polarity passes through the affirmative answer", () => {
    expect(focalVerdictFromAffirmative(true, "positive")).toBe("pass");
    expect(focalVerdictFromAffirmative(false, "positive")).toBe("fail");
  });

  test("negative polarity inverts the affirmative answer", () => {
    // affirmative claim holds → negative rule violated → fail
    expect(focalVerdictFromAffirmative(true, "negative")).toBe("fail");
    // affirmative claim absent → negative rule satisfied → pass
    expect(focalVerdictFromAffirmative(false, "negative")).toBe("pass");
  });
});
