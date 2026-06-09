// Lower primitives → Excalidraw skeleton + files map.
//
// One pass over `spec.elements`, producing the array of objects that
// convertToExcalidrawElements consumes plus a files map for any image
// references. No layout math, no styling defaults, no text policy — the
// agent already made every aesthetic decision in the spec.
//
// Ergonomic expansions performed here (and ONLY these):
//   1. label-as-string → label-as-object with fontSize 20
//   2. arrow.from/to as element id → start/end bindings + computed
//      geometry (line clipped to bounding boxes of the bound shapes)
//   3. arrow.from/to as {x,y} → absolute point, no binding
//   4. frame.children with no explicit bounds → bounds auto-fit around
//      children + padding (default 16)
//   5. image.src → file id, file-map entry with base64 dataURL

import { readFile } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";

import type {
  Arrow,
  Diamond,
  Element,
  Ellipse,
  Embeddable,
  Endpoint,
  Frame,
  Freedraw,
  Iframe,
  Image,
  Label,
  Line,
  Rectangle,
  Spec,
  Text,
} from "./spec.js";

export interface FilesMap {
  [fileId: string]: {
    id: string;
    dataURL: string;
    mimeType: string;
    created: number;
  };
}

export interface LowerOutput {
  skeleton: Record<string, unknown>[];
  files: FilesMap;
  appState: {
    viewBackgroundColor: string;
    exportBackground: boolean;
  };
  viewport: { width: number; height: number };
}

export interface LowerContext {
  /** Directory containing the spec file (for resolving relative image paths). */
  specDir: string;
}

const DEFAULT_LABEL_FONT_SIZE = 20;
const DEFAULT_TEXT_FONT_SIZE = 20;
const DEFAULT_FRAME_PADDING = 16;

export async function lower(spec: Spec, ctx: LowerContext): Promise<LowerOutput> {
  // Index shapes by id for arrow + frame resolution. Auto-fit shapes
  // (width/height omitted) get placeholder dims here; autofit.ts will
  // recompute arrow geometry against the real measured sizes.
  const DRAFT_W = 240;
  const DRAFT_H = 80;
  const shapeById = new Map<string, BoundingBox>();
  for (const el of spec.elements) {
    if (
      (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") &&
      el.id
    ) {
      shapeById.set(el.id, {
        x: el.x,
        y: el.y,
        width: el.width ?? DRAFT_W,
        height: el.height ?? DRAFT_H,
      });
    }
  }

  // Skeleton is built in two passes so frames (containers) emit BEFORE
  // their contents and labels — i.e. they render UNDER nodes in z-order.
  // Frame corner labels are emitted as extra text primitives at the
  // frame's top-left corner so positioning is deterministic (Excalidraw's
  // own frame `name` is auto-placed above the frame and we want predictable
  // corner placement instead).
  const frameSkeleton: Record<string, unknown>[] = [];
  const frameLabels: Record<string, unknown>[] = [];
  const contentSkeleton: Record<string, unknown>[] = [];
  const files: FilesMap = {};

  for (const el of spec.elements) {
    switch (el.type) {
      case "rectangle":
      case "ellipse":
      case "diamond":
        contentSkeleton.push(lowerShape(el));
        break;
      case "arrow":
      case "line":
        contentSkeleton.push(lowerConnector(el, shapeById));
        break;
      case "text":
        contentSkeleton.push(lowerText(el));
        break;
      case "freedraw":
        contentSkeleton.push(lowerFreedraw(el));
        break;
      case "frame": {
        const { frame, cornerLabel } = lowerFrame(el, shapeById);
        frameSkeleton.push(frame);
        if (cornerLabel) frameLabels.push(cornerLabel);
        break;
      }
      case "image":
        contentSkeleton.push(await lowerImage(el, ctx, files));
        break;
      case "embeddable":
        contentSkeleton.push(lowerEmbeddable(el));
        break;
      case "iframe":
        contentSkeleton.push(lowerIframe(el));
        break;
      default: {
        const exhaustive: never = el;
        throw new Error(`unhandled element type: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  // Order: frames first (drawn under), then frame labels (above the frame
  // background but below content), then all other content (on top).
  const skeleton = [...frameSkeleton, ...frameLabels, ...contentSkeleton];

  return {
    skeleton,
    files,
    appState: {
      viewBackgroundColor: spec.background ?? "#FFFFFF",
      exportBackground: true,
    },
    viewport: spec.viewport,
  };
}

// ---- Shapes ----------------------------------------------------------

function lowerShape(el: Rectangle | Ellipse | Diamond): Record<string, unknown> {
  if ((el.width === undefined || el.height === undefined) && el.label === undefined) {
    throw new Error(
      `${el.type} "${el.id}": both width and height are omitted but there's no label to size to. Provide explicit width/height, or add a label.`,
    );
  }
  // For shapes where dimensions are omitted (auto-fit), use a placeholder
  // size on this draft pass — the autofit step will replace it with the
  // measured label dimensions + padding. Using a sentinel rather than
  // attempting to guess avoids the approximation trap.
  const DRAFT_W = 240;
  const DRAFT_H = 80;
  const width = el.width ?? DRAFT_W;
  const height = el.height ?? DRAFT_H;
  const out: Record<string, unknown> = {
    type: el.type,
    id: el.id,
    x: el.x,
    y: el.y,
    width,
    height,
  };
  copyDefined(el, out, [
    "strokeColor",
    "backgroundColor",
    "fillStyle",
    "strokeWidth",
    "strokeStyle",
    "roughness",
    "opacity",
    "roundness",
    "angle",
  ]);
  if (el.label !== undefined) out.label = expandLabel(el.label);
  // Mark this element so the autofit step knows to resize it. The
  // marker is stripped before the final render.
  if (el.width === undefined || el.height === undefined) {
    out.$autoFit = {
      widthOmitted: el.width === undefined,
      heightOmitted: el.height === undefined,
    };
  }
  return out;
}

// ---- Connectors (arrow, line) ---------------------------------------

function lowerConnector(
  el: Arrow | Line,
  shapeById: Map<string, BoundingBox>,
): Record<string, unknown> {
  const startPoint = resolveEndpoint(el.from, "from", shapeById);
  const endPoint = resolveEndpoint(el.to, "to", shapeById);
  const { x, y, points } = computeArrowGeometry(startPoint, endPoint);

  // Excalidraw's default arrowhead is "arrow" on the end. We honour
  // explicit nulls so a line with no arrowheads stays clean.
  const endArrowhead =
    el.endArrowhead === undefined
      ? el.type === "arrow"
        ? "arrow"
        : null
      : el.endArrowhead;
  const startArrowhead = el.startArrowhead === undefined ? null : el.startArrowhead;

  const out: Record<string, unknown> = {
    type: el.type,
    x,
    y,
    width: Math.abs(points[1][0] - points[0][0]),
    height: Math.abs(points[1][1] - points[0][1]),
    points,
    startArrowhead,
    endArrowhead,
  };
  if (el.id) out.id = el.id;
  if (typeof el.from === "string") out.start = { id: el.from };
  if (typeof el.to === "string") out.end = { id: el.to };
  copyDefined(el, out, ["strokeColor", "strokeWidth", "strokeStyle", "roughness", "opacity"]);
  if (el.label !== undefined) out.label = expandLabel(el.label);
  return out;
}

interface ResolvedPoint {
  x: number;
  y: number;
  /** True when point came from a bound shape's center (will be clipped). */
  fromShape?: BoundingBox;
}

function resolveEndpoint(
  ep: Endpoint,
  which: "from" | "to",
  shapeById: Map<string, BoundingBox>,
): ResolvedPoint {
  if (typeof ep === "string") {
    const bbox = shapeById.get(ep);
    if (!bbox) {
      throw new Error(
        `arrow.${which} references unknown shape id "${ep}". The shape must be defined elsewhere in elements[] before validation.`,
      );
    }
    return {
      x: bbox.x + bbox.width / 2,
      y: bbox.y + bbox.height / 2,
      fromShape: bbox,
    };
  }
  return { x: ep.x, y: ep.y };
}

/**
 * Compute initial arrow geometry. If an endpoint is a bound shape's
 * center, clip the line to the shape's border so the arrow visually
 * touches the box edge instead of the center. Excalidraw only updates
 * geometry when shapes move in the live editor — first paint relies on
 * what we compute here.
 */
function computeArrowGeometry(
  start: ResolvedPoint,
  end: ResolvedPoint,
): { x: number; y: number; points: [[number, number], [number, number]] } {
  let sx = start.x;
  let sy = start.y;
  let ex = end.x;
  let ey = end.y;

  if (start.fromShape) {
    const clipped = clipPointToBox(end.x, end.y, start.x, start.y, start.fromShape);
    sx = clipped.x;
    sy = clipped.y;
  }
  if (end.fromShape) {
    const clipped = clipPointToBox(start.x, start.y, end.x, end.y, end.fromShape);
    ex = clipped.x;
    ey = clipped.y;
  }

  return {
    x: sx,
    y: sy,
    points: [
      [0, 0],
      [ex - sx, ey - sy],
    ],
  };
}

/**
 * Given a target point (tx, ty) and a source point (px, py) inside
 * `box`, return the point on box's edge along the line from (px,py)
 * toward (tx,ty). Axis-aligned rectangle clip; close enough for ellipses
 * and diamonds at typical box sizes.
 */
function clipPointToBox(
  tx: number,
  ty: number,
  px: number,
  py: number,
  box: BoundingBox,
): { x: number; y: number } {
  const dx = tx - px;
  const dy = ty - py;
  if (dx === 0 && dy === 0) return { x: px, y: py };

  const hw = box.width / 2;
  const hh = box.height / 2;
  const cx = box.x + hw;
  const cy = box.y + hh;

  // Parametric line from box center; find smallest t > 0 where we exit.
  const ts: number[] = [];
  if (dx !== 0) {
    ts.push((cx + hw - cx) / dx);
    ts.push((cx - hw - cx) / dx);
  }
  if (dy !== 0) {
    ts.push((cy + hh - cy) / dy);
    ts.push((cy - hh - cy) / dy);
  }
  const t = Math.min(...ts.filter((v) => v > 0));
  if (!isFinite(t)) return { x: px, y: py };
  return { x: cx + dx * t, y: cy + dy * t };
}

// ---- Text ------------------------------------------------------------

function lowerText(el: Text): Record<string, unknown> {
  const fontSize = el.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
  const fontFamily = el.fontFamily ?? 2;

  // Width/height are deliberately NOT computed here. If the agent set
  // them, we pass them through (Excalidraw will wrap text to width). If
  // omitted, we leave them off the skeleton entirely so Excalidraw
  // computes natural single-line dims itself via the actual font. The
  // autofit step then sees real measurements and the validation step
  // catches viewport overflow with real pixel math.
  const out: Record<string, unknown> = {
    type: "text",
    x: el.x,
    y: el.y,
    text: el.text,
    fontSize,
    fontFamily,
  };
  if (el.width !== undefined) out.width = el.width;
  if (el.height !== undefined) out.height = el.height;
  if (el.id) out.id = el.id;
  copyDefined(el, out, ["strokeColor", "textAlign", "verticalAlign", "opacity", "angle"]);
  return out;
}

// ---- Freedraw --------------------------------------------------------

function lowerFreedraw(el: Freedraw): Record<string, unknown> {
  if (el.points.length === 0) {
    throw new Error(`freedraw[${el.id ?? "?"}].points must have at least one point`);
  }
  const xs = el.points.map((p) => p[0]);
  const ys = el.points.map((p) => p[1]);
  const out: Record<string, unknown> = {
    type: "freedraw",
    x: el.x,
    y: el.y,
    points: el.points,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  if (el.id) out.id = el.id;
  copyDefined(el, out, ["pressures", "simulatePressure", "strokeColor", "strokeWidth", "opacity"]);
  return out;
}

// ---- Frame -----------------------------------------------------------

function lowerFrame(
  el: Frame,
  shapeById: Map<string, BoundingBox>,
): { frame: Record<string, unknown>; cornerLabel: Record<string, unknown> | null } {
  let bounds: BoundingBox;
  if (
    typeof el.x === "number" &&
    typeof el.y === "number" &&
    typeof el.width === "number" &&
    typeof el.height === "number"
  ) {
    bounds = { x: el.x, y: el.y, width: el.width, height: el.height };
  } else if (el.children && el.children.length > 0) {
    bounds = computeChildrenBounds(el.children, shapeById, el.padding ?? DEFAULT_FRAME_PADDING);
  } else {
    throw new Error(
      `frame[${el.id}] must either set x/y/width/height explicitly or provide children[] to auto-fit.`,
    );
  }
  // We lower the `frame` primitive to a styled rectangle, NOT Excalidraw's
  // own `frame` element. Reasons:
  //   - Excalidraw's frame element auto-renders a "Frame N" placeholder
  //     label above the bounds that cannot be reliably suppressed.
  //   - Excalidraw's frame element clips its children visually, which is
  //     not the container behavior callers expect.
  //   - For static export (PNG/SVG/.excalidraw), a rectangle gives us full
  //     control over stroke, fill, opacity, and z-order, with no magic.
  //
  // Tradeoff: the saved .excalidraw file won't carry the "drag frame
  // to move children together" semantic when re-opened in the Excalidraw
  // editor. Users who need that can group the children manually.
  const frame: Record<string, unknown> = {
    type: "rectangle",
    id: el.id,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    strokeColor: "#9CA3AF",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roundness: { type: 3 },
    roughness: 0,
  };

  let cornerLabel: Record<string, unknown> | null = null;
  if (el.label) {
    const FONT = 14;
    const PAD_X = 12;
    const PAD_Y = 8;
    cornerLabel = {
      type: "text",
      x: bounds.x + PAD_X,
      y: bounds.y + PAD_Y,
      text: el.label,
      fontSize: FONT,
      fontFamily: 2,
      strokeColor: "#666666",
    };
  }
  return { frame, cornerLabel };
}

function computeChildrenBounds(
  ids: string[],
  shapeById: Map<string, BoundingBox>,
  padding: number,
): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const b = shapeById.get(id);
    if (!b) {
      throw new Error(`frame.children references unknown shape id "${id}"`);
    }
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

// ---- Image -----------------------------------------------------------

async function lowerImage(el: Image, ctx: LowerContext, files: FilesMap): Promise<Record<string, unknown>> {
  const absPath = resolve(ctx.specDir, el.src);
  const buf = await readFile(absPath);
  const mime = mimeForPath(absPath);
  const dataURL = `data:${mime};base64,${buf.toString("base64")}`;
  const fileId = hashFileId(buf);
  files[fileId] = {
    id: fileId,
    dataURL,
    mimeType: mime,
    created: Date.now(),
  };
  const out: Record<string, unknown> = {
    type: "image",
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    fileId,
    status: "saved",
  };
  if (el.id) out.id = el.id;
  copyDefined(el, out, ["opacity", "angle"]);
  return out;
}

function mimeForPath(p: string): string {
  switch (extname(p).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      throw new Error(`image.src: unsupported extension at ${p}`);
  }
}

/** Cheap content-addressable id. Excalidraw doesn't care about the format. */
function hashFileId(buf: Buffer): string {
  let h = 5381;
  for (let i = 0; i < buf.length; i++) {
    h = ((h << 5) + h + buf[i]) | 0;
  }
  return `file-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

// ---- Embeddable / Iframe ---------------------------------------------

function lowerEmbeddable(el: Embeddable): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: "embeddable",
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    link: el.link,
  };
  if (el.id) out.id = el.id;
  if (el.opacity !== undefined) out.opacity = el.opacity;
  return out;
}

function lowerIframe(el: Iframe): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: "iframe",
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    link: el.link,
  };
  if (el.id) out.id = el.id;
  if (el.opacity !== undefined) out.opacity = el.opacity;
  return out;
}

// ---- Helpers ---------------------------------------------------------

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function expandLabel(label: Label): Record<string, unknown> {
  if (typeof label === "string") {
    return { text: label, fontSize: DEFAULT_LABEL_FONT_SIZE, fontFamily: 2 };
  }
  const out: Record<string, unknown> = {
    text: label.text,
    fontSize: label.fontSize ?? DEFAULT_LABEL_FONT_SIZE,
    fontFamily: 2,
  };
  copyDefined(label, out, ["strokeColor", "textAlign", "verticalAlign"]);
  return out;
}

function copyDefined<T extends object>(src: T, dst: Record<string, unknown>, keys: Array<keyof T>): void {
  for (const k of keys) {
    const v = src[k];
    if (v !== undefined) dst[k as string] = v;
  }
}
