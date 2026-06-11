import { describe, expect, it } from "vitest";

import { TransportLegFailure, withTransportRetry } from "./transportRetry.js";

// 5.4 — the pre-registered transport-failure amendment (Phase-4 board S7),
// applied to every Phase-5 real-model leg. Zero-model with injected shims.

const transportError = (): Error => new Error("claude CLI timed out after 120000ms");

describe("transport failures follow the pre-registered amendment", () => {
  it("one transport death is a null observation consuming the retry; the retry's value lands", async () => {
    let calls = 0;
    const value = await withTransportRetry(async () => {
      calls += 1;
      if (calls === 1) throw transportError();
      return "observed";
    });
    expect(value).toBe("observed");
    expect(calls).toBe(2);
  });

  it("two transport deaths on the same observation fail the leg outright — never a silent pass", async () => {
    await expect(
      withTransportRetry(async () => {
        throw transportError();
      }),
    ).rejects.toBeInstanceOf(TransportLegFailure);
  });

  it("an assertion failure propagates immediately without consuming a retry", async () => {
    let calls = 0;
    class AssertionError extends Error {}
    await expect(
      withTransportRetry(async () => {
        calls += 1;
        throw new AssertionError("expected reject, got accept");
      }),
    ).rejects.toBeInstanceOf(AssertionError);
    expect(calls).toBe(1); // never retried — programming errors are not transport noise
  });
});
