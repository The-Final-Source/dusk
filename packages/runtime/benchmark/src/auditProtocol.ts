import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AuditThresholdsSchema, duskError, err, ok, type AuditThresholds, type RuntimeResult } from "@dusk/core-schema";

/**
 * Pre-registration enforcement — Phase 5 design D1. The checked-in
 * `audit-thresholds.json` IS the freeze. The audit REFUSES to score (typed
 * error, nothing scored) when the file is absent, `frozen !== true`, or the
 * calibration set intersects the about-to-be-scored set — calibration data is
 * never test data, by construction rather than discipline.
 */

export const AUDIT_REFUSALS = ["missing_pre_registration", "not_frozen", "calibration_overlap"] as const;
export type AuditRefusal = (typeof AUDIT_REFUSALS)[number];

/** The checked-in thresholds artifact (`packages/runtime/benchmark/audit-thresholds.json`). */
export function defaultThresholdsPath(): string {
  return fileURLToPath(new URL("../audit-thresholds.json", import.meta.url));
}

export function enforcePreRegistration(opts: {
  thresholdsPath: string;
  scoredFixtureIds: string[];
}): RuntimeResult<AuditThresholds> {
  if (!existsSync(opts.thresholdsPath)) {
    return err(
      duskError(
        "config_invalid",
        `the audit refuses to score: pre-registered thresholds are absent at ${opts.thresholdsPath} — run \`dusk benchmark --calibrate-audit\` and freeze the bars BEFORE scoring the known-bad set`,
        { recoverable: true, details: { refusal: "missing_pre_registration" satisfies AuditRefusal } },
      ),
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(opts.thresholdsPath, "utf8"));
  } catch {
    raw = null;
  }
  const parsed = AuditThresholdsSchema.safeParse(raw);
  if (!parsed.success) {
    const frozen = typeof raw === "object" && raw !== null ? (raw as { frozen?: unknown }).frozen : undefined;
    const why = frozen !== true ? "thresholds are not frozen (`frozen: true` is the freeze)" : `thresholds file is invalid: ${parsed.error.issues[0]?.message}`;
    return err(
      duskError("config_invalid", `the audit refuses to score: ${why}`, {
        recoverable: true,
        details: { refusal: "not_frozen" satisfies AuditRefusal },
      }),
    );
  }

  const overlap = parsed.data.calibration_fixture_ids.filter((id) => opts.scoredFixtureIds.includes(id));
  if (overlap.length > 0) {
    return err(
      duskError(
        "config_invalid",
        `the audit refuses to score: calibration fixtures intersect the scored set (${overlap.join(", ")}) — calibration data is never test data`,
        { recoverable: true, details: { refusal: "calibration_overlap" satisfies AuditRefusal, overlapping_fixture_ids: overlap } },
      ),
    );
  }

  return ok(parsed.data);
}
