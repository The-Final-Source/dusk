import type { SupportQuality, TripleVerdict } from "@dusk/core-schema";

/**
 * Pure aggregation rule (RFC §3.3, App. A.4; design D9): `support_quality` from
 * per-claim `triple_verdict[]`. Any `mismatch` → low_confidence; else ≥50% vague
 * → low_confidence; else ok. No support claims → ok.
 */
export function aggregateSupportQuality(verdicts: readonly TripleVerdict[]): SupportQuality {
  if (verdicts.length === 0) return "ok";
  if (verdicts.some((v) => v === "mismatch")) return "low_confidence";
  const vague = verdicts.filter((v) => v === "vague").length;
  if (vague / verdicts.length >= 0.5) return "low_confidence";
  return "ok";
}
