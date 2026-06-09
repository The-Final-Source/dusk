// Skeleton orchestration: parse spec → structural validate → lower → autofit + real-pixel validate → stylistic audit.
//
// All the actual work lives in spec.ts, validate.ts, lower.ts, autofit.ts,
// and audit.ts. The autofit step uses the actual Excalidraw renderer for
// measurement — see autofit.ts for why approximation-based validation was
// retired. The audit step is advisory-only — see audit.ts.

import { auditMeasurements } from "./audit.js";
import { autofitAndMeasure } from "./autofit.js";
import { lower } from "./lower.js";
import { parseSpec } from "./spec.js";
import { validateSpec } from "./validate.js";
import type { FilesMap } from "./lower.js";

export interface SkeletonOutput {
  skeleton: Record<string, unknown>[];
  files: FilesMap;
  appState: {
    viewBackgroundColor: string;
    exportBackground: boolean;
  };
  viewport: { width: number; height: number };
  /** Advisory stylistic warnings from audit.ts. Never block the build. */
  warnings: string[];
}

export interface BuildSkeletonOptions {
  /** Directory of the spec file — used to resolve relative image paths. */
  specDir: string;
  rebuildRenderer?: boolean;
  timeoutMs?: number;
}

export async function buildSkeleton(rawSpec: unknown, options: BuildSkeletonOptions): Promise<SkeletonOutput> {
  const spec = parseSpec(rawSpec);

  // Pass 1: cheap structural validation (no rendering required).
  const structural = await validateSpec(spec, { specDir: options.specDir });
  if (!structural.ok) {
    const list = structural.errors.map((e) => `  - ${e}`).join("\n");
    throw new Error(`structural validation failed:\n${list}`);
  }

  // Pass 2: lower primitives → draft skeleton (with auto-fit markers).
  const draft = await lower(spec, { specDir: options.specDir });

  // Pass 3: render-based measurement, auto-fit, real-pixel validation.
  const { skeleton, measurements } = await autofitAndMeasure(draft.skeleton, {
    viewport: spec.viewport,
    rebuildRenderer: options.rebuildRenderer,
    timeoutMs: options.timeoutMs,
  });

  // Pass 4: advisory stylistic audit (never blocking).
  // Uses the FINAL post-autofit measurements so warnings reflect the
  // shape sizes that will actually render — not the agent's draft input.
  const warnings = auditMeasurements(measurements);

  return {
    skeleton,
    files: draft.files,
    appState: draft.appState,
    viewport: draft.viewport,
    warnings,
  };
}
