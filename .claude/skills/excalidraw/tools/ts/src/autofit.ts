// Auto-fit + real-pixel validation pass.
//
// Runs AFTER lower.ts has produced a draft skeleton and AFTER measureSkeleton
// has called the actual Excalidraw renderer to compute element dimensions.
// Uses the real measurements (not approximations) to:
//   1. Resize shapes that the agent left without width/height (auto-fit-to-label)
//   2. Re-measure (one more round) so auto-fitted shapes' bound labels also have accurate dims
//   3. Validate the FINAL skeleton against the viewport (no off-canvas elements)
//   4. Validate no unintentional overlaps between free-floating text/shapes
//
// The autofit step is what makes the agent's life livable: they declare
// position + label and let the tool size the container. The validation step
// is what enforces the no-cutoff/no-overlap guarantees with real pixel math.

import { measureSkeleton, type Measurements } from "./render.js";

const LABEL_PAD_X = 16; // each side
const LABEL_PAD_Y = 12; // top + bottom each
const MIN_SHAPE_W = 80;
const MIN_SHAPE_H = 48;

export interface AutofitOptions {
  rebuildRenderer?: boolean;
  timeoutMs?: number;
  /** Used for viewport-overflow validation in pass 2. */
  viewport: { width: number; height: number };
}

export interface AutofitResult {
  /** The skeleton with all $autoFit markers resolved + stripped. */
  skeleton: Record<string, unknown>[];
  /** The actual measurements used to produce it (post-autofit, for validation). */
  measurements: Measurements;
}

export async function autofitAndMeasure(
  draftSkeleton: Record<string, unknown>[],
  options: AutofitOptions,
): Promise<AutofitResult> {
  // ---- Pass 1: measure the draft (with placeholder sizes for auto-fit shapes) ----
  // We need actual label dimensions to compute auto-fit sizes. Excalidraw
  // wraps bound labels to the container's inner width, so for an auto-fit
  // shape we want the label's NATURAL width — not its wrapped width.
  //
  // Strategy: for any shape with $autoFit, temporarily widen its draft size
  // huge enough that the label can't wrap, then measure. The measured
  // bound-label dims are the natural single-line dims.
  const probeSkeleton = draftSkeleton.map((el) => {
    if (!el.$autoFit) return el;
    return {
      ...el,
      width: 4000,
      height: 600,
    };
  });

  const pass1 = await measureSkeleton(probeSkeleton, options);

  // ---- Apply auto-fit using the natural label dims ----
  const resizedById = new Map<string, { x: number; y: number; width: number; height: number }>();
  const fittedSkeleton = draftSkeleton.map((el) => {
    if (!el.$autoFit) {
      // Track current dims for arrow-geometry recompute.
      if (typeof el.id === "string" && typeof el.width === "number" && typeof el.height === "number") {
        resizedById.set(el.id, {
          x: el.x as number,
          y: el.y as number,
          width: el.width as number,
          height: el.height as number,
        });
      }
      return el;
    }
    const auto = el.$autoFit as { widthOmitted: boolean; heightOmitted: boolean };
    const id = el.id as string;
    const label = pass1.boundLabels[id];
    const out = { ...el } as Record<string, unknown>;
    if (label) {
      if (auto.widthOmitted) {
        out.width = Math.max(MIN_SHAPE_W, Math.ceil(label.width + LABEL_PAD_X * 2));
      }
      if (auto.heightOmitted) {
        out.height = Math.max(MIN_SHAPE_H, Math.ceil(label.height + LABEL_PAD_Y * 2));
      }
    } else {
      if (auto.widthOmitted) out.width = MIN_SHAPE_W;
      if (auto.heightOmitted) out.height = MIN_SHAPE_H;
    }
    delete (out as { $autoFit?: unknown }).$autoFit;
    resizedById.set(id, {
      x: out.x as number,
      y: out.y as number,
      width: out.width as number,
      height: out.height as number,
    });
    return out;
  });

  // ---- Recompute arrow/line geometry against the FINAL shape sizes ----
  // Shape positions never change (the agent picked them); only sizes for
  // auto-fit shapes shift. Arrows bound to those shapes need their points
  // recomputed so they visibly touch the new edges.
  const finalSkeleton = fittedSkeleton.map((el) => {
    if (el.type !== "arrow" && el.type !== "line") return el;
    const startId = (el.start as { id?: string } | undefined)?.id;
    const endId = (el.end as { id?: string } | undefined)?.id;
    if (!startId && !endId) return el; // free-floating, no recompute

    const out = { ...el } as Record<string, unknown>;
    const startBox = startId ? resizedById.get(startId) : undefined;
    const endBox = endId ? resizedById.get(endId) : undefined;

    // Source point (center, then clipped to box edge).
    let sx: number;
    let sy: number;
    let ex: number;
    let ey: number;
    if (startBox) {
      sx = startBox.x + startBox.width / 2;
      sy = startBox.y + startBox.height / 2;
    } else {
      // No binding → use the original x as the starting point.
      sx = el.x as number;
      sy = el.y as number;
    }
    if (endBox) {
      ex = endBox.x + endBox.width / 2;
      ey = endBox.y + endBox.height / 2;
    } else {
      // Original points carried absolute end as the second point offset.
      const pts = el.points as number[][];
      ex = (el.x as number) + pts[1][0];
      ey = (el.y as number) + pts[1][1];
    }
    if (startBox) {
      const c = clipPointToBox(ex, ey, sx, sy, startBox);
      sx = c.x;
      sy = c.y;
    }
    if (endBox) {
      const c = clipPointToBox(sx, sy, ex, ey, endBox);
      ex = c.x;
      ey = c.y;
    }
    out.x = sx;
    out.y = sy;
    out.width = Math.abs(ex - sx);
    out.height = Math.abs(ey - sy);
    out.points = [
      [0, 0],
      [ex - sx, ey - sy],
    ];
    return out;
  });

  // ---- Pass 2: re-measure the final skeleton ----
  // Auto-fit shapes now have realistic sizes; bound labels remeasured at the
  // final container width may have different (wrapped) dims for shapes the
  // agent explicitly sized too narrow — and that's what we want to validate.
  const pass2 = await measureSkeleton(finalSkeleton, options);

  // ---- Validate against the final measurements ----
  const errors = validateMeasurements(finalSkeleton, pass2, options.viewport);
  if (errors.length > 0) {
    throw new Error(`real-measurement validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }

  return { skeleton: finalSkeleton, measurements: pass2 };
}

// ---- Validation against real measurements ---------------------------

function validateMeasurements(
  skeleton: Record<string, unknown>[],
  m: Measurements,
  viewport: { width: number; height: number },
): string[] {
  const errors: string[] = [];

  // Index by id for cross-referencing.
  const byId = new Map<string, Record<string, unknown>>();
  for (const el of skeleton) {
    const id = el.id as string | undefined;
    if (id) byId.set(id, el);
  }

  // 1. Viewport overflow — for every element with a measurement.
  for (const [id, meas] of Object.entries(m.measurements)) {
    if (meas.x < 0) {
      errors.push(
        `${meas.type} "${id}" starts off the LEFT edge of the viewport (x=${meas.x}). Move x right, or widen the viewport.`,
      );
    }
    if (meas.y < 0) {
      errors.push(
        `${meas.type} "${id}" starts off the TOP edge of the viewport (y=${meas.y}).`,
      );
    }
    if (meas.x + meas.width > viewport.width) {
      const overflow = Math.ceil(meas.x + meas.width - viewport.width);
      errors.push(
        `${meas.type} "${id}" extends ${overflow}px past the RIGHT edge of the viewport (measured width ${Math.ceil(meas.width)}px from x=${meas.x}, viewport.width=${viewport.width}). Reduce content width or widen the viewport.`,
      );
    }
    if (meas.y + meas.height > viewport.height) {
      const overflow = Math.ceil(meas.y + meas.height - viewport.height);
      errors.push(
        `${meas.type} "${id}" extends ${overflow}px past the BOTTOM edge of the viewport.`,
      );
    }
  }

  // 2. Bound-label fit — only for SHAPE containers (rectangle/ellipse/diamond).
  // Arrow labels are anchored to the arrow midpoint; they don't need to fit
  // inside a container.
  for (const [containerId, label] of Object.entries(m.boundLabels)) {
    const shape = m.measurements[containerId];
    if (!shape) continue;
    if (shape.type !== "rectangle" && shape.type !== "ellipse" && shape.type !== "diamond") continue;
    const innerH = shape.height - LABEL_PAD_Y * 2;
    if (label.height > innerH + 2 /* small slop */) {
      errors.push(
        `shape "${containerId}" label "${truncate(label.text, 40)}" at fontSize ${label.fontSize}: label wraps to ${Math.ceil(label.height)}px tall but container inner height is only ${Math.ceil(innerH)}px. Increase the shape's height, widen it so the label fits on fewer lines, or shrink fontSize.`,
      );
    }
  }

  // 3. Unintentional overlap among free-floating text and shapes.
  // We check pairs of (text, shape) and (text, text) where the text is NOT
  // a bound label. Bound labels live inside their container intentionally.
  const freeTextIds: string[] = [];
  const shapeIds: string[] = [];
  for (const [id, meas] of Object.entries(m.measurements)) {
    if (meas.type === "text") {
      // Skip bound labels: they appear in m.measurements too but are
      // expected to overlap with their container shape. We detect bound
      // labels by checking if the element id appears as a key in
      // m.boundLabels (Excalidraw routes bound labels with the same id
      // as the container only when there's no separate id — to be safe,
      // we also skip text that the user didn't assign an id to).
      const sourceEl = byId.get(id);
      // Free-floating text in our spec is type:"text" at top-level.
      // Bound labels are not top-level entries (they come from `label`
      // on shapes), so byId only knows about free-floating text.
      if (sourceEl && sourceEl.type === "text") freeTextIds.push(id);
    } else if (meas.type === "rectangle" || meas.type === "ellipse" || meas.type === "diamond") {
      shapeIds.push(id);
    }
  }

  for (const textId of freeTextIds) {
    const t = m.measurements[textId];
    for (const shapeId of shapeIds) {
      const s = m.measurements[shapeId];
      if (rectanglesOverlap(t, s)) {
        errors.push(
          `text "${textId}" overlaps shape "${shapeId}". text bbox = (${t.x},${t.y})..(${t.x + t.width},${t.y + t.height}); shape bbox = (${s.x},${s.y})..(${s.x + s.width},${s.y + s.height}). Move the text so it doesn't sit on top of the shape, OR bind the caption to the shape via the shape's "label" field.`,
        );
      }
    }
    // Also flag overlapping text-text pairs.
    for (const otherId of freeTextIds) {
      if (otherId <= textId) continue;
      const o = m.measurements[otherId];
      if (rectanglesOverlap(t, o)) {
        errors.push(
          `text "${textId}" overlaps text "${otherId}". Move one of them.`,
        );
      }
    }
  }

  return errors;
}

/**
 * Given a target point (tx, ty) and a box, return the point on the box's
 * edge along the line from box-center toward (tx,ty). Axis-aligned
 * rectangle clip; close enough for ellipses and diamonds at typical
 * box sizes.
 */
function clipPointToBox(
  tx: number,
  ty: number,
  _px: number,
  _py: number,
  box: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const hw = box.width / 2;
  const hh = box.height / 2;
  const cx = box.x + hw;
  const cy = box.y + hh;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const ts: number[] = [];
  if (dx !== 0) {
    ts.push(hw / dx);
    ts.push(-hw / dx);
  }
  if (dy !== 0) {
    ts.push(hh / dy);
    ts.push(-hh / dy);
  }
  const tPos = ts.filter((v) => v > 0);
  if (tPos.length === 0) return { x: cx, y: cy };
  const t = Math.min(...tPos);
  return { x: cx + dx * t, y: cy + dy * t };
}

function rectanglesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
