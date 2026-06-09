// Stylistic audit pass — advisory warnings, never blocking.
//
// Runs AFTER autofit succeeds (so the geometry is correct and all hard
// errors have been resolved). Catches issues that aren't structural
// failures — the diagram still renders correctly — but indicate the
// spec made a suboptimal aesthetic choice. Output is a string array of
// human-readable warnings the build prints to stderr with a "⚠" marker.
//
// Design rules for this file:
//
//   1. NEVER modify the spec or skeleton. Read-only.
//   2. NEVER throw. Return warnings, let the caller print them.
//   3. NEVER fail the build. These checks are advisory — the agent owns
//      the decision to address them.
//   4. Keep checks objective and cheap. Each check should be
//      computable from the post-autofit Measurements alone, with no
//      additional rendering or LLM call.
//   5. Keep the file focused on STYLISTIC issues — anything that should
//      block the build belongs in validate.ts (structural) or
//      autofit.ts (real-pixel hard errors), not here.
//   6. Tune to catch the FAILURE MODE — "label floating in unused space
//      because explicit width was set too generously" — without firing
//      on intentionally-wide structural elements (visual bands,
//      decision diamonds, cards/containers, legend swatches). False
//      positives degrade the signal; bias toward fewer-but-meaningful
//      warnings.
//
// Current checks:
//   - Label density: rectangles in the "content node" size range
//     (medium height) whose bound label fills less than 25% of the
//     container's inner width. Containers that are clearly bands
//     (very short), clearly cards/containers (very tall), or diamonds
//     (different visual conventions) are skipped.
//
// Future checks to consider (only add when there's a clear win and a
// real threshold to calibrate against; otherwise leave for the design
// critic loop):
//   - Adjacent-shape size disparity (one shape dwarfs its siblings)
//   - Color contrast on labels (when not auto-contrast-handled by skeleton.ts)
//   - Free-floating text that COULD bind to a nearby shape
//   - Arrows that visibly cross unrelated shapes (geometry-based check)

import type { Measurements } from "./render.js";

// Padding constants must match those in autofit.ts; if they ever
// diverge, both files need updating together.
const LABEL_PAD_X = 16;

// Density threshold. Calibrated empirically: at <0.25 the visual reads
// as "label floating in a sea of empty space" — the failure mode we're
// catching. 25%-and-above is "loose but tolerable"; we don't fire there
// to avoid drowning the signal in borderline cases.
const MIN_WIDTH_RATIO = 0.25;

// Containers narrower than this skip the check — for tiny shapes
// (legend swatches, inline markers) padding dominates and the ratio
// is meaningless.
const MIN_CONTAINER_WIDTH = 200;

// Containers shorter than this are visual bands / section headers, not
// content nodes. The intent there is horizontal span, not density.
const MIN_CONTAINER_HEIGHT = 60;

// Containers taller than this are cards / large zones / multi-paragraph
// content holders. Their width is driven by container purpose, not
// label tightness — the density check isn't the right signal.
const MAX_CONTAINER_HEIGHT = 240;

export function auditMeasurements(measurements: Measurements): string[] {
  const warnings: string[] = [];

  for (const [containerId, label] of Object.entries(measurements.boundLabels)) {
    const shape = measurements.measurements[containerId];
    if (!shape) continue;

    // Only audit rectangles. Diamonds have wider bounding boxes than
    // their inner usable area (the rhombus is narrowest at top/bottom),
    // so the rectangle-area ratio mis-reports them. Ellipses are
    // typically used as actors/endpoints where size is conventional.
    if (shape.type !== "rectangle") continue;

    if (shape.width < MIN_CONTAINER_WIDTH) continue;
    if (shape.height < MIN_CONTAINER_HEIGHT) continue; // visual bands
    if (shape.height > MAX_CONTAINER_HEIGHT) continue; // cards / containers

    const innerW = Math.max(1, shape.width - LABEL_PAD_X * 2);
    const widthRatio = label.width / innerW;
    if (widthRatio >= MIN_WIDTH_RATIO) continue;

    const ratioPct = Math.round(widthRatio * 100);
    const containerW = Math.ceil(shape.width);
    const labelW = Math.ceil(label.width);
    warnings.push(
      `low label density on rectangle "${containerId}": ` +
        `label fills only ~${ratioPct}% of inner width ` +
        `(label=${labelW}px in a ${containerW}px container). ` +
        `Consider omitting width/height (auto-fit), or setting width to roughly ${Math.ceil(labelW + LABEL_PAD_X * 2 + 32)}px to match the content. ` +
        `(label text: "${truncate(label.text, 50)}")`,
    );
  }

  return warnings;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
